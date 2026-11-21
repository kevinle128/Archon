/**
 * MCP server handler against an in-memory stand-in for the Archon REST API.
 *
 * The handler reaches Archon only through `archon-api.ts` (HTTP requests to
 * `/api/*`), so a small Hono app that implements those routes is enough to
 * drive every tool and task method deterministically, without a database.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';

import { createArchonApi, forwardedAuthHeaders } from './archon-api';
import { RUN_ROW_TIMEOUT_MS, createMcpServerHandler, resolveCodebase } from './server-factory';

const BASE = 'https://archon.example.ts.net';
const TASKS = 'io.modelcontextprotocol/tasks';

interface FakeRun {
  run: Record<string, unknown>;
  events: Record<string, unknown>[];
}

interface Recorded {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

const state = {
  runs: new Map<string, FakeRun>(),
  calls: [] as Recorded[],
  createRowOnStart: true,
  dispatchStatus: 'started',
  approveStatus: 200,
  messages: [] as { role: string; content: string }[],
  interactions: new Map<string, Record<string, unknown>[]>(),
  viewerIsStarter: true,
  /** Answer-route status per tool_use_id; unlisted ids answer 200. */
  answerStatus: new Map<string, number>(),
  permissionStatus: 200,
};

const codebases = [
  {
    id: 'cb-1',
    name: 'kevinle128/paseo',
    repository_url: 'https://github.com/kevinle128/paseo.git',
    default_cwd: '/repos/paseo',
  },
  { id: 'cb-2', name: 'other', repository_url: null, default_cwd: '/repos/other' },
];

function makeRunRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    workflow_name: 'paseo-fork-upstream-resolve',
    status: 'running',
    codebase_id: 'cb-1',
    metadata: {},
    started_at: '2026-11-08T00:00:00.000Z',
    completed_at: null,
    last_activity_at: '2026-11-08T00:01:00.000Z',
    ...overrides,
  };
}

function seedRun(
  id: string,
  overrides: Record<string, unknown> = {},
  events: Record<string, unknown>[] = []
): void {
  state.runs.set(id, { run: makeRunRow(id, overrides), events });
}

const fakeApi = new Hono();
fakeApi.use('*', async (c, next) => {
  let body: unknown;
  if (c.req.method === 'POST') {
    const text = await c.req.text();
    body = text ? (JSON.parse(text) as unknown) : undefined;
  }
  state.calls.push({ method: c.req.method, path: c.req.path, body, headers: c.req.raw.headers });
  await next();
});
fakeApi.get('/api/codebases', c => c.json(codebases));
fakeApi.get('/api/codebases/:id', c => {
  const found = codebases.find(cb => cb.id === c.req.param('id'));
  return found ? c.json(found) : c.json({ error: 'Codebase not found' }, 404);
});
fakeApi.get('/api/workflows', c => {
  if (c.req.query('cwd') !== '/repos/paseo') return c.json({ workflows: [], recommended: [] });
  return c.json({
    workflows: [
      {
        workflow: { name: 'paseo-fork-upstream-resolve', returns: 'finalize', nodes: [] },
        source: 'bundled',
      },
    ],
    recommended: [],
  });
});
fakeApi.post('/api/conversations', c => c.json({ conversationId: 'web-conv-1', id: 'db-conv-1' }));
fakeApi.post('/api/workflows/:name/run', async c => {
  const body = state.calls.at(-1)?.body as { runId: string };
  if (state.createRowOnStart) seedRun(body.runId);
  return c.json({ accepted: true, status: state.dispatchStatus, runId: body.runId });
});
fakeApi.get('/api/workflows/runs', c => {
  const status = c.req.query('status');
  const runs = [...state.runs.values()]
    .map(r => r.run)
    .filter(r => status === undefined || r.status === status);
  return c.json({ runs });
});
fakeApi.get('/api/workflows/runs/:runId', c => {
  const found = state.runs.get(c.req.param('runId'));
  if (!found) return c.json({ error: 'Workflow run not found' }, 404);
  return c.json({
    run: found.run,
    events: found.events,
    nodeStates: [],
    pending_interactions: state.interactions.get(c.req.param('runId')) ?? [],
    viewer_is_starter: state.viewerIsStarter,
  });
});
fakeApi.post('/api/workflows/runs/:runId/approve', c =>
  state.approveStatus === 200
    ? c.json({ success: true, message: 'ok' })
    : c.json({ error: 'Workflow run is not paused' }, 400)
);
fakeApi.post('/api/workflows/runs/:runId/reject', c => c.json({ success: true, message: 'ok' }));
/** Like `cancelWorkflowRun`: the run becomes cancelled and its pending rows purged together. */
fakeApi.post('/api/workflows/runs/:runId/cancel', c => {
  const runId = c.req.param('runId');
  const found = state.runs.get(runId);
  if (!found) return c.json({ error: 'Workflow run not found' }, 404);
  if (!['running', 'pending', 'paused'].includes(found.run.status as string)) {
    return c.json({ error: 'Cannot cancel a finished run' }, 400);
  }
  found.run.status = 'cancelled';
  for (const row of state.interactions.get(runId) ?? []) {
    if (row.status === 'pending') row.status = 'purged';
  }
  return c.json({ success: true, message: 'ok' });
});

/** Mark the row answered; the last pending answer resumes the run, as core does. */
function resolveRow(runId: string, toolUseId: string): void {
  const rows = state.interactions.get(runId) ?? [];
  const row = rows.find(r => r.tool_use_id === toolUseId);
  if (row) row.status = 'answered';
  const found = state.runs.get(runId);
  if (found && !rows.some(r => r.status === 'pending')) found.run.status = 'running';
}
fakeApi.post('/api/workflows/runs/:runId/ask/:toolUseId/answer', c => {
  const toolUseId = c.req.param('toolUseId');
  const status = state.answerStatus.get(toolUseId) ?? 200;
  if (status !== 200)
    return c.json({ error: `answer refused with ${String(status)}` }, status as 400);
  resolveRow(c.req.param('runId'), toolUseId);
  return c.json({ success: true, message: 'ok' });
});
fakeApi.post('/api/workflows/runs/:runId/permissions/:toolUseId/confirm', c => {
  if (state.permissionStatus !== 200) {
    return c.json({ error: 'Only the run starter can confirm' }, state.permissionStatus as 403);
  }
  resolveRow(c.req.param('runId'), c.req.param('toolUseId'));
  return c.json({ success: true, message: 'ok' });
});
fakeApi.get('/api/conversations/:id/messages', c => c.json(state.messages));

const handler = createMcpServerHandler({
  apiFor: request =>
    createArchonApi(
      async (path, init) => fakeApi.request(path, init),
      forwardedAuthHeaders(request.headers)
    ),
  baseUrlFor: () => BASE,
  runRowTimeoutMs: 60,
  runRowPollMs: 10,
});

interface RpcOptions {
  name?: string;
  tasks?: boolean;
  elicitation?: boolean;
  headers?: Record<string, string>;
}

let nextId = 1;
async function rpc(
  method: string,
  params: Record<string, unknown>,
  options: RpcOptions = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const capabilities: Record<string, unknown> = {
    ...(options.elicitation ? { elicitation: { form: {} } } : {}),
    ...(options.tasks === false ? {} : { extensions: { [TASKS]: {} } }),
  };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
    ...(options.name !== undefined ? { 'mcp-name': options.name } : {}),
    ...options.headers,
  };
  const response = await handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextId++,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': capabilities,
          },
        },
      }),
    })
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

type Json = Record<string, unknown>;
const resultOf = (body: Json): Json => body.result as Json;
const errorOf = (body: Json): { code: number; message: string; data?: Json } =>
  body.error as { code: number; message: string; data?: Json };

async function callTool(name: string, args: Json, options: RpcOptions = {}): Promise<Json> {
  const { body } = await rpc('tools/call', { name, arguments: args }, { name, ...options });
  return resultOf(body);
}

function callsTo(method: string, pathSuffix: string): Recorded[] {
  return state.calls.filter(c => c.method === method && c.path.endsWith(pathSuffix));
}

beforeEach(() => {
  state.runs.clear();
  state.calls.length = 0;
  state.createRowOnStart = true;
  state.dispatchStatus = 'started';
  state.approveStatus = 200;
  state.messages = [];
  state.interactions.clear();
  state.viewerIsStarter = true;
  state.answerStatus.clear();
  state.permissionStatus = 200;
});

describe('discovery and protocol era', () => {
  test('server/discover lists both extensions and 2026-07-28', async () => {
    const { status, body } = await rpc('server/discover', {});
    expect(status).toBe(200);
    const result = resultOf(body);
    expect(result.supportedVersions).toEqual(['2026-07-28']);
    const capabilities = result.capabilities as { extensions: Json };
    expect(Object.keys(capabilities.extensions).sort()).toEqual([
      'io.modelcontextprotocol/events',
      'io.modelcontextprotocol/tasks',
    ]);
  });

  test('a 2025-era initialize is rejected with -32022', async () => {
    const response = await handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'x', version: '1' },
          },
        }),
      })
    );
    expect(response.status).toBe(400);
    expect(errorOf((await response.json()) as Json).code).toBe(-32022);
  });

  test('tools/list returns run_workflow, get_run, list_runs in that order', async () => {
    const { body } = await rpc('tools/list', {});
    const tools = resultOf(body).tools as {
      name: string;
      inputSchema: { properties: Json; required: string[] };
    }[];
    expect(tools.map(t => t.name)).toEqual(['run_workflow', 'get_run', 'list_runs']);
    const runWorkflow = tools[0];
    expect(Object.keys(runWorkflow?.inputSchema.properties ?? {}).sort()).toEqual([
      'codebase',
      'message',
      'workflow',
    ]);
    expect(runWorkflow?.inputSchema.required.sort()).toEqual(['codebase', 'message', 'workflow']);
  });
});

describe('resolveCodebase', () => {
  test('matches an id, a case-insensitive name, or a repository URL', () => {
    expect(resolveCodebase(codebases, 'cb-2')).toMatchObject({
      ok: true,
      codebase: { id: 'cb-2' },
    });
    expect(resolveCodebase(codebases, 'KevinLe128/Paseo')).toMatchObject({
      ok: true,
      codebase: { id: 'cb-1' },
    });
    expect(resolveCodebase(codebases, 'github.com/kevinle128/paseo')).toMatchObject({
      ok: true,
      codebase: { id: 'cb-1' },
    });
    expect(resolveCodebase(codebases, 'https://github.com/kevinle128/paseo')).toMatchObject({
      ok: true,
    });
  });

  test('lists the candidates when nothing or more than one matches', () => {
    const missing = resolveCodebase(codebases, 'paseo');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain('kevinle128/paseo');
    const twins = [codebases[1], { ...codebases[1], id: 'cb-3' }] as typeof codebases;
    const ambiguous = resolveCodebase(twins, 'OTHER');
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.error).toContain('cb-3');
  });
});

describe('run_workflow', () => {
  const args = {
    workflow: 'paseo-fork-upstream-resolve',
    codebase: 'kevinle128/paseo',
    message: 'Resolve issue #12 https://github.com/kevinle128/paseo/issues/12',
  };

  test('with the tasks extension returns a flat CreateTaskResult whose taskId is the run id', async () => {
    const result = await callTool('run_workflow', args);

    const runCall = callsTo('POST', '/api/workflows/paseo-fork-upstream-resolve/run')[0];
    const sent = runCall?.body as { conversationId: string; message: string; runId: string };
    expect(sent.conversationId).toBe('web-conv-1');
    expect(sent.message).toBe(args.message);
    expect(Object.keys(sent).sort()).toEqual(['conversationId', 'message', 'runId']);
    expect(callsTo('POST', '/api/conversations')[0]?.body).toEqual({ codebaseId: 'cb-1' });

    expect(result).toMatchObject({
      resultType: 'task',
      taskId: sent.runId,
      status: 'working',
      ttlMs: 2_592_000_000,
      pollIntervalMs: 5000,
      createdAt: '2026-11-08T00:00:00.000Z',
    });
    expect(result.task).toBeUndefined();
    expect(result.inputRequests).toBeUndefined();
  });

  test('without the tasks extension returns a plain result with run_id and url', async () => {
    const result = await callTool('run_workflow', args, { tasks: false });
    const runId = (callsTo('POST', '/run')[0]?.body as { runId: string }).runId;
    expect(result.resultType).toBe('complete');
    expect(result.structuredContent).toEqual({ run_id: runId, url: `${BASE}/runs/${runId}` });
  });

  test('reports an error with the last chat message when the run row never appears', async () => {
    state.createRowOnStart = false;
    state.dispatchStatus = 'queued-capacity';
    state.messages = [
      { role: 'user', content: '/workflow run x' },
      { role: 'assistant', content: 'Codebase not found.' },
    ];
    const result = await callTool('run_workflow', args);
    const runId = (callsTo('POST', '/run')[0]?.body as { runId: string }).runId;
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    expect(text).toContain(runId);
    expect(text).toContain('Codebase not found.');
    expect(text).toContain('the run may still start with this run id; poll get_run or tasks/get');
  });

  test('the timeout hint is given for every lock status, not only a full queue', async () => {
    state.createRowOnStart = false;
    state.dispatchStatus = 'started';
    const result = await callTool('run_workflow', args);
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    expect(text).toContain('the run may still start with this run id; poll get_run or tasks/get');
  });

  test('waits up to 120 s for the run row by default', () => {
    expect(RUN_ROW_TIMEOUT_MS).toBe(120_000);
  });

  test('refuses an unknown codebase or workflow before dispatch', async () => {
    const noCodebase = await callTool('run_workflow', { ...args, codebase: 'nope' });
    expect(noCodebase.isError).toBe(true);
    const noWorkflow = await callTool('run_workflow', { ...args, workflow: 'missing' });
    expect(noWorkflow.isError).toBe(true);
    expect(callsTo('POST', '/run')).toHaveLength(0);
    expect(callsTo('POST', '/api/conversations')).toHaveLength(0);
  });

  test('forwards the caller identity header to the REST API but not MCP headers', async () => {
    await callTool('run_workflow', args, { headers: { 'X-Archon-User': 'alice' } });
    const runCall = callsTo('POST', '/run')[0];
    expect(runCall?.headers.get('x-archon-user')).toBe('alice');
    expect(runCall?.headers.get('mcp-method')).toBeNull();
  });
});

describe('get_run and list_runs', () => {
  test('get_run returns the run summary', async () => {
    seedRun('00000000-0000-4000-8000-000000000001', {}, [
      {
        event_type: 'node_completed',
        step_name: 'publish',
        data: { node_output: '{"pr_url":"https://pr/9"}' },
      },
      { event_type: 'node_started', step_name: 'wait-ci', data: {} },
    ]);
    const result = await callTool('get_run', { run_id: '00000000-0000-4000-8000-000000000001' });
    expect(result.structuredContent).toMatchObject({
      run_id: '00000000-0000-4000-8000-000000000001',
      workflow: 'paseo-fork-upstream-resolve',
      status: 'running',
      task_status: 'working',
      current_node: 'wait-ci',
      pr_url: 'https://pr/9',
      url: `${BASE}/runs/00000000-0000-4000-8000-000000000001`,
    });
  });

  test('get_run refuses an id that is not a run id without calling the API', async () => {
    const result = await callTool('get_run', { run_id: 'not-a-run-id' });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toContain('Invalid run id');
    expect(callsTo('GET', '/api/workflows/runs/not-a-run-id')).toHaveLength(0);
  });

  test('get_run reports an unknown run as a tool error', async () => {
    expect(
      (await callTool('get_run', { run_id: '00000000-0000-4000-8000-0000000000ff' })).isError
    ).toBe(true);
  });

  test('list_runs filters by workflow and status and applies the limit', async () => {
    seedRun('00000000-0000-4000-8000-000000000011');
    seedRun('00000000-0000-4000-8000-000000000012', { workflow_name: 'other-workflow' });
    seedRun('00000000-0000-4000-8000-000000000013', { status: 'completed' });
    const result = await callTool('list_runs', {
      workflow: 'paseo-fork-upstream-resolve',
      status: 'running',
      limit: 5,
    });
    const runs = (result.structuredContent as { runs: { run_id: string }[] }).runs;
    expect(runs.map(r => r.run_id)).toEqual(['00000000-0000-4000-8000-000000000011']);
  });
});

describe('tasks/get', () => {
  test('working', async () => {
    seedRun('00000000-0000-4000-8000-000000000002', {}, [
      { event_type: 'node_started', step_name: 'resolve', data: {} },
    ]);
    const { body } = await rpc(
      'tasks/get',
      { taskId: '00000000-0000-4000-8000-000000000002' },
      { name: '00000000-0000-4000-8000-000000000002' }
    );
    expect(resultOf(body)).toMatchObject({
      resultType: 'complete',
      taskId: '00000000-0000-4000-8000-000000000002',
      status: 'working',
      statusMessage: 'resolve',
      ttlMs: 2_592_000_000,
    });
  });

  const pausedMeta = {
    status: 'paused',
    metadata: {
      approval: { nodeId: 'decide', message: 'Use ours?', type: 'approval', resolved: null },
    },
  };

  test('input_required with elicitation declared carries the form request', async () => {
    seedRun('00000000-0000-4000-8000-000000000003', pausedMeta);
    const { body } = await rpc(
      'tasks/get',
      { taskId: '00000000-0000-4000-8000-000000000003' },
      { name: '00000000-0000-4000-8000-000000000003', elicitation: true }
    );
    const task = resultOf(body);
    expect(task.status).toBe('input_required');
    expect(Object.keys(task.inputRequests as Json)).toEqual(['approval-decide']);
  });

  test('input_required without elicitation sends an empty request map and the UI link', async () => {
    seedRun('00000000-0000-4000-8000-000000000003', pausedMeta);
    const { body } = await rpc(
      'tasks/get',
      { taskId: '00000000-0000-4000-8000-000000000003' },
      { name: '00000000-0000-4000-8000-000000000003' }
    );
    const task = resultOf(body);
    expect(task.status).toBe('input_required');
    expect(task.inputRequests).toEqual({});
    expect(task.statusMessage).toBe(
      `Use ours? Answer in the Archon UI: ${BASE}/runs/00000000-0000-4000-8000-000000000003`
    );
  });

  test('completed reads the result from the workflow returns node', async () => {
    seedRun(
      '00000000-0000-4000-8000-000000000004',
      { status: 'completed', completed_at: '2026-11-08T02:00:00.000Z' },
      [
        {
          event_type: 'node_completed',
          step_name: 'finalize',
          data: {
            node_output: JSON.stringify({
              outcome: 'pr_ready',
              pr_url: 'https://pr/3',
              ci: { conclusion: 'success', failed: [], checks_url: 'https://pr/3/checks' },
            }),
          },
        },
        { event_type: 'node_completed', step_name: 'cleanup', data: { node_output: 'done' } },
      ]
    );
    const { body } = await rpc(
      'tasks/get',
      { taskId: '00000000-0000-4000-8000-000000000004' },
      { name: '00000000-0000-4000-8000-000000000004' }
    );
    const task = resultOf(body);
    expect(task.status).toBe('completed');
    const result = task.result as { resultType: string; structuredContent: Json };
    expect(result.resultType).toBe('complete');
    expect(result.structuredContent).toMatchObject({
      outcome: 'pr_ready',
      pr_url: 'https://pr/3',
      ci: { conclusion: 'success' },
    });
  });

  test('failed carries the error', async () => {
    seedRun('00000000-0000-4000-8000-000000000005', {
      status: 'failed',
      metadata: { error: 'merge failed' },
    });
    const { body } = await rpc(
      'tasks/get',
      { taskId: '00000000-0000-4000-8000-000000000005' },
      { name: '00000000-0000-4000-8000-000000000005' }
    );
    expect(resultOf(body)).toMatchObject({
      status: 'failed',
      error: { code: -32603, message: 'merge failed' },
    });
  });

  test('cancelled', async () => {
    seedRun('00000000-0000-4000-8000-000000000006', { status: 'cancelled' });
    const { body } = await rpc(
      'tasks/get',
      { taskId: '00000000-0000-4000-8000-000000000006' },
      { name: '00000000-0000-4000-8000-000000000006' }
    );
    expect(resultOf(body).status).toBe('cancelled');
  });

  test.each([['tasks/get'], ['tasks/update'], ['tasks/cancel']])(
    '%s with an id that is not a run id is -32602, not an internal error',
    async method => {
      const { body } = await rpc(
        method,
        { taskId: 'not-a-run-id', ...(method === 'tasks/update' ? { inputResponses: {} } : {}) },
        { name: 'not-a-run-id' }
      );
      expect(errorOf(body).code).toBe(-32602);
      expect(state.calls).toHaveLength(0);
    }
  );

  test('accepts the hyphen-less 32-hex form that SQLite generates', async () => {
    seedRun('0b14d0e10caa7c3eb606a004e22d1916');
    const { body } = await rpc(
      'tasks/get',
      { taskId: '0b14d0e10caa7c3eb606a004e22d1916' },
      { name: '0b14d0e10caa7c3eb606a004e22d1916' }
    );
    expect(resultOf(body).status).toBe('working');
  });

  test('an unknown task is -32602', async () => {
    const unknown = '00000000-0000-4000-8000-0000000000ff';
    const { body } = await rpc('tasks/get', { taskId: unknown }, { name: unknown });
    expect(errorOf(body).code).toBe(-32602);
  });

  test('an Mcp-Name header that does not match taskId is 400 / -32020', async () => {
    seedRun('00000000-0000-4000-8000-000000000002');
    const { status, body } = await rpc(
      'tasks/get',
      { taskId: '00000000-0000-4000-8000-000000000002' },
      { name: 'other' }
    );
    expect(status).toBe(400);
    expect(errorOf(body).code).toBe(-32020);
  });
});

describe('tasks/update', () => {
  const RUN_P = '00000000-0000-4000-8000-000000000003';
  const pausedRun = (pauseNumber = 1): void => {
    const events: Record<string, unknown>[] = [];
    for (let i = 1; i <= pauseNumber; i++) {
      events.push({
        event_type: 'approval_requested',
        step_name: 'decide',
        data: { nodeId: 'decide' },
      });
      if (i < pauseNumber) {
        events.push({
          event_type: 'approval_received',
          step_name: 'decide',
          data: { decision: 'approved' },
        });
      }
    }
    seedRun(
      RUN_P,
      {
        status: 'paused',
        metadata: {
          approval: { nodeId: 'decide', message: 'Use ours?', type: 'approval', resolved: null },
        },
      },
      events
    );
  };
  const update = (inputResponses: Json): ReturnType<typeof rpc> =>
    rpc(
      'tasks/update',
      { taskId: '00000000-0000-4000-8000-000000000003', inputResponses },
      { name: '00000000-0000-4000-8000-000000000003' }
    );

  test('accept + approve calls the approve route with the comment', async () => {
    pausedRun();
    const { body } = await update({
      'approval-decide': {
        action: 'accept',
        content: { decision: 'approve', comment: 'looks right' },
      },
    });
    expect(resultOf(body)).toMatchObject({ resultType: 'complete' });
    expect(callsTo('POST', '/runs/00000000-0000-4000-8000-000000000003/approve')[0]?.body).toEqual({
      comment: 'looks right',
    });
  });

  test('accept + reject calls the reject route with the comment or a default reason', async () => {
    pausedRun();
    await update({
      'approval-decide': {
        action: 'accept',
        content: { decision: 'reject', comment: 'wrong side' },
      },
    });
    await update({ 'approval-decide': { action: 'accept', content: { decision: 'reject' } } });
    expect(
      callsTo('POST', '/runs/00000000-0000-4000-8000-000000000003/reject').map(c => c.body)
    ).toEqual([{ reason: 'wrong side' }, { reason: 'Rejected through MCP' }]);
  });

  test('decline and cancel actions do nothing', async () => {
    pausedRun();
    await update({ 'approval-decide': { action: 'decline' } });
    await update({ 'approval-decide': { action: 'cancel' } });
    expect(callsTo('POST', '/approve')).toHaveLength(0);
    expect(callsTo('POST', '/reject')).toHaveLength(0);
  });

  test('a stale key from an earlier pause does nothing', async () => {
    pausedRun(2);
    const { body } = await update({
      'approval-decide': { action: 'accept', content: { decision: 'approve' } },
    });
    expect(resultOf(body)).toMatchObject({ resultType: 'complete' });
    expect(callsTo('POST', '/approve')).toHaveLength(0);
    await update({ 'approval-decide-2': { action: 'accept', content: { decision: 'approve' } } });
    expect(callsTo('POST', '/approve')).toHaveLength(1);
  });

  test('a REST refusal is returned as -32602 with the route message', async () => {
    pausedRun();
    state.approveStatus = 400;
    const { body } = await update({
      'approval-decide': { action: 'accept', content: { decision: 'approve' } },
    });
    expect(errorOf(body)).toMatchObject({ code: -32602, message: 'Workflow run is not paused' });
  });
});

describe('tasks/cancel', () => {
  test('a working run is cancelled', async () => {
    seedRun('00000000-0000-4000-8000-000000000002');
    await rpc(
      'tasks/cancel',
      { taskId: '00000000-0000-4000-8000-000000000002' },
      { name: '00000000-0000-4000-8000-000000000002' }
    );
    expect(callsTo('POST', '/runs/00000000-0000-4000-8000-000000000002/cancel')).toHaveLength(1);
  });

  test('a run waiting for an answer stays paused: ack only', async () => {
    seedRun('00000000-0000-4000-8000-000000000003', {
      status: 'paused',
      metadata: { approval: { nodeId: 'decide', message: 'q', type: 'approval', resolved: null } },
    });
    const { body } = await rpc(
      'tasks/cancel',
      { taskId: '00000000-0000-4000-8000-000000000003' },
      { name: '00000000-0000-4000-8000-000000000003' }
    );
    expect(resultOf(body)).toMatchObject({ resultType: 'complete' });
    expect(callsTo('POST', '/cancel')).toHaveLength(0);
  });

  test('a terminal run is acknowledged without a cancel call', async () => {
    seedRun('00000000-0000-4000-8000-000000000004', { status: 'completed' });
    await rpc(
      'tasks/cancel',
      { taskId: '00000000-0000-4000-8000-000000000004' },
      { name: '00000000-0000-4000-8000-000000000004' }
    );
    expect(callsTo('POST', '/cancel')).toHaveLength(0);
  });
});

describe('tasks with AskHuman and permission input', () => {
  const RUN = '00000000-0000-4000-8000-000000000009';
  const SCOPE_QUESTION = {
    id: 'scope',
    prompt: 'Which scope?',
    selection: 'single',
    options: ['small', 'large'],
    allowOther: false,
  };
  const askRow = (toolUseId: string, nodeId = 'plan'): Record<string, unknown> => ({
    tool_use_id: toolUseId,
    node_id: nodeId,
    kind: 'ask',
    status: 'pending',
    envelope: { questions: [SCOPE_QUESTION] },
  });
  const permissionRow = (toolUseId: string): Record<string, unknown> => ({
    tool_use_id: toolUseId,
    node_id: 'deploy',
    kind: 'permission',
    status: 'pending',
    envelope: { secret: 'never shown' },
  });
  const seedWaiting = (rows: Record<string, unknown>[], overrides: Json = {}): void => {
    seedRun(RUN, { status: 'paused', ...overrides });
    state.interactions.set(RUN, rows);
  };
  const call = (
    method: 'tasks/get' | 'tasks/update' | 'tasks/cancel',
    options: RpcOptions & { inputResponses?: Json } = {}
  ): ReturnType<typeof rpc> => {
    const { inputResponses, ...rpcOptions } = options;
    return rpc(
      method,
      { taskId: RUN, ...(inputResponses ? { inputResponses } : {}) },
      { name: RUN, ...rpcOptions }
    );
  };
  const pickSmall = { action: 'accept', content: { q1: 'small' } };

  test('tasks/get reports input_required with the ask request for a paused run', async () => {
    seedWaiting([askRow('tu-1')]);
    const task = resultOf((await call('tasks/get', { elicitation: true })).body);
    expect(task.status).toBe('input_required');
    const request = (task.inputRequests as Json)['ask-tu-1'] as {
      method: string;
      params: { message: string; requestedSchema: Json };
    };
    expect(request.method).toBe('elicitation/create');
    expect(request.params.message).toBe('Which scope?');
    expect(request.params.requestedSchema).toMatchObject({
      properties: { q1: { type: 'string', enum: ['small', 'large'] } },
      required: ['q1'],
    });
  });

  test('tasks/update answers an Ask through the answer route', async () => {
    seedWaiting([askRow('tu-1')]);
    const { body } = await call('tasks/update', { inputResponses: { 'ask-tu-1': pickSmall } });
    expect(resultOf(body)).toMatchObject({ resultType: 'complete' });
    const posts = callsTo('POST', '/ask/tu-1/answer');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ answers: [{ questionId: 'scope', value: 'small' }] });
  });

  test('tasks/update sends decline for a declined Ask', async () => {
    seedWaiting([askRow('tu-1')]);
    await call('tasks/update', { inputResponses: { 'ask-tu-1': { action: 'decline' } } });
    expect(callsTo('POST', '/ask/tu-1/answer')[0]?.body).toEqual({ decline: true });
  });

  test('tasks/update ignores a cancelled Ask', async () => {
    seedWaiting([askRow('tu-1')]);
    const { body } = await call('tasks/update', {
      inputResponses: { 'ask-tu-1': { action: 'cancel' } },
    });
    expect(resultOf(body)).toMatchObject({ resultType: 'complete' });
    expect(callsTo('POST', '/answer')).toHaveLength(0);
  });

  test('tasks/update answers one of two pending Asks and leaves the other open', async () => {
    seedWaiting([askRow('tu-1'), askRow('tu-2', 'review')]);
    await call('tasks/update', { inputResponses: { 'ask-tu-1': pickSmall } });
    const task = resultOf((await call('tasks/get', { elicitation: true })).body);
    expect(task.status).toBe('input_required');
    expect(Object.keys(task.inputRequests as Json)).toEqual(['ask-tu-2']);
    await call('tasks/update', { inputResponses: { 'ask-tu-2': pickSmall } });
    expect(resultOf((await call('tasks/get', { elicitation: true })).body).status).toBe('working');
  });

  test('tasks/update applies the approval before Ask answers in one call', async () => {
    seedWaiting([askRow('tu-1')], {
      metadata: {
        approval: { nodeId: 'decide', message: 'Go?', type: 'approval', resolved: null },
      },
    });
    await call('tasks/update', {
      inputResponses: {
        'ask-tu-1': pickSmall,
        'approval-decide': { action: 'accept', content: { decision: 'approve' } },
      },
    });
    const order = state.calls
      .filter(c => c.method === 'POST')
      .map(c => (c.path.endsWith('/approve') ? 'approve' : 'answer'));
    expect(order).toEqual(['approve', 'answer']);
  });

  test('tasks/update ignores an Ask answered elsewhere (409)', async () => {
    seedWaiting([askRow('tu-1')]);
    state.answerStatus.set('tu-1', 409);
    const { body } = await call('tasks/update', { inputResponses: { 'ask-tu-1': pickSmall } });
    expect(resultOf(body)).toMatchObject({ resultType: 'complete' });
  });

  test('tasks/update reports a rejected Ask answer (400) with the failed key', async () => {
    seedWaiting([askRow('tu-1')]);
    state.answerStatus.set('tu-1', 400);
    const { body } = await call('tasks/update', { inputResponses: { 'ask-tu-1': pickSmall } });
    expect(errorOf(body)).toMatchObject({
      code: -32602,
      data: { failed: [{ key: 'ask-tu-1' }], applied: [] },
    });
  });

  test('tasks/update reports failed keys after applying the others and a retry applies only the failed one', async () => {
    seedWaiting([askRow('tu-1'), askRow('tu-2')]);
    state.answerStatus.set('tu-2', 400);
    const both = { 'ask-tu-1': pickSmall, 'ask-tu-2': pickSmall };
    const first = await call('tasks/update', { inputResponses: both });
    expect(errorOf(first.body).data).toMatchObject({
      failed: [{ key: 'ask-tu-2' }],
      applied: ['ask-tu-1'],
    });
    state.answerStatus.clear();
    await call('tasks/update', { inputResponses: both });
    expect(callsTo('POST', '/ask/tu-1/answer')).toHaveLength(1);
    expect(callsTo('POST', '/ask/tu-2/answer')).toHaveLength(2);
  });

  test('tasks/update fails an Ask answer that misses a question before any request', async () => {
    seedWaiting([askRow('tu-1')]);
    const { body } = await call('tasks/update', {
      inputResponses: { 'ask-tu-1': { action: 'accept', content: {} } },
    });
    expect(errorOf(body)).toMatchObject({ code: -32602, data: { failed: [{ key: 'ask-tu-1' }] } });
    expect(callsTo('POST', '/answer')).toHaveLength(0);
  });

  test('tasks/update confirms a permission with the intent text', async () => {
    seedWaiting([permissionRow('tu-p')]);
    await call('tasks/update', {
      inputResponses: { 'permission-tu-p': { action: 'accept', content: { intent: 'go ahead' } } },
    });
    expect(callsTo('POST', '/permissions/tu-p/confirm')[0]?.body).toEqual({ intent: 'go ahead' });
  });

  test('tasks/update reports a forbidden permission confirm (403)', async () => {
    seedWaiting([permissionRow('tu-p')]);
    state.permissionStatus = 403;
    const { body } = await call('tasks/update', {
      inputResponses: { 'permission-tu-p': { action: 'accept', content: { intent: 'go ahead' } } },
    });
    expect(errorOf(body)).toMatchObject({
      code: -32602,
      data: { failed: [{ key: 'permission-tu-p' }] },
    });
  });

  test('tasks/update error data for a failed permission confirm holds no intent text', async () => {
    seedWaiting([permissionRow('tu-p')]);
    state.permissionStatus = 403;
    const { body } = await call('tasks/update', {
      inputResponses: {
        'permission-tu-p': { action: 'accept', content: { intent: 'my private decision' } },
      },
    });
    expect(JSON.stringify(errorOf(body))).not.toContain('my private decision');
  });

  test('tasks/update ignores a permission key for a caller who did not start the run', async () => {
    seedWaiting([permissionRow('tu-p')]);
    state.viewerIsStarter = false;
    await call('tasks/update', {
      inputResponses: { 'permission-tu-p': { action: 'accept', content: { intent: 'go ahead' } } },
    });
    expect(callsTo('POST', '/confirm')).toHaveLength(0);
  });

  test('tasks/update forwards the caller identity headers to the answer route', async () => {
    seedWaiting([askRow('tu-1')]);
    await call('tasks/update', {
      inputResponses: { 'ask-tu-1': pickSmall },
      headers: { cookie: 'sid=abc' },
    });
    expect(callsTo('POST', '/answer')[0]?.headers.get('cookie')).toBe('sid=abc');
  });

  test('tasks/cancel cancels a run waiting on an Ask and the Ask is no longer open', async () => {
    seedWaiting([askRow('tu-1')]);
    await call('tasks/cancel');
    expect(callsTo('POST', `/runs/${RUN}/cancel`)).toHaveLength(1);
    const task = resultOf((await call('tasks/get', { elicitation: true })).body);
    expect(task.status).toBe('cancelled');
    expect(task.inputRequests).toBeUndefined();
    expect(state.interactions.get(RUN)?.[0]?.status).toBe('purged');
  });

  test('tasks/cancel cancels a run waiting on a permission the caller did not start', async () => {
    seedWaiting([permissionRow('tu-p')]);
    state.viewerIsStarter = false;
    await call('tasks/cancel');
    expect(callsTo('POST', `/runs/${RUN}/cancel`)).toHaveLength(1);
  });

  test('tasks/cancel keeps a run at an approval gate paused even with an open Ask', async () => {
    seedWaiting([askRow('tu-1')], {
      metadata: {
        approval: { nodeId: 'decide', message: 'Go?', type: 'approval', resolved: null },
      },
    });
    await call('tasks/cancel');
    expect(callsTo('POST', '/cancel')).toHaveLength(0);
  });

  test('tasks/cancel twice returns no error and calls the cancel route once', async () => {
    seedWaiting([askRow('tu-1')]);
    const first = await call('tasks/cancel');
    const second = await call('tasks/cancel');
    expect(first.body.error).toBeUndefined();
    expect(second.body.error).toBeUndefined();
    expect(callsTo('POST', '/cancel')).toHaveLength(1);
  });

  test('tasks/cancel forwards the caller identity headers to the cancel route', async () => {
    seedWaiting([askRow('tu-1')]);
    await call('tasks/cancel', { headers: { cookie: 'sid=abc' } });
    expect(callsTo('POST', '/cancel')[0]?.headers.get('cookie')).toBe('sid=abc');
  });
});

describe('tasks extension not declared', () => {
  test.each([['tasks/get'], ['tasks/update'], ['tasks/cancel']])(
    '%s answers -32021',
    async method => {
      seedRun('00000000-0000-4000-8000-000000000002');
      const { status, body } = await rpc(
        method,
        {
          taskId: '00000000-0000-4000-8000-000000000002',
          ...(method === 'tasks/update' ? { inputResponses: {} } : {}),
        },
        { name: '00000000-0000-4000-8000-000000000002', tasks: false }
      );
      expect(status).toBe(400);
      expect(errorOf(body)).toMatchObject({
        code: -32021,
        data: { requiredCapabilities: { extensions: { [TASKS]: {} } } },
      });
    }
  );
});
