/**
 * Events extension over HTTP, backed by a real SQLite status log in a
 * temporary ARCHON_HOME (never the user's ~/.archon).
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import type { McpHttpHandler } from '@modelcontextprotocol/server';

const archonHome = mkdtempSync(join(tmpdir(), 'archon-mcp-events-'));
process.env.ARCHON_HOME = archonHome;
delete process.env.DATABASE_URL;

const { pool, closeDatabase } = await import('@archon/core/db/connection');
const { appendStatusLogRow } = await import('@archon/core/db/workflow-run-status-log');
const { createDbEventsStore, STATUS_EVENT_NAME } = await import('./events');
const { StatusLogSignal } = await import('./run-status-log');
const { registerMcpRoute } = await import('./route');

afterAll(async () => {
  await closeDatabase();
  rmSync(archonHome, { recursive: true, force: true });
});

const passGate: MiddlewareHandler = async (_c, next) => next();
const unusedSdkHandler = {
  fetch: async () => new Response('sdk', { status: 418 }),
} as unknown as McpHttpHandler;

let signal = new StatusLogSignal();
let fixedNow: number | undefined;

function makeApp(): OpenAPIHono {
  const app = new OpenAPIHono();
  registerMcpRoute(app, {
    accessGate: passGate,
    mcpHandler: unusedSdkHandler,
    events: {
      store: createDbEventsStore(),
      signal,
      heartbeatMs: 25,
      now: () => fixedNow ?? Date.now(),
    },
  });
  return app;
}

type Json = Record<string, unknown>;
let nextId = 1;

function eventsRequest(
  method: string,
  params: Json,
  headerOverrides: Record<string, string | undefined> = {}
): Request {
  const name = typeof params.name === 'string' ? params.name : undefined;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
    ...(name !== undefined && method !== 'events/list' ? { 'mcp-name': name } : {}),
  };
  for (const [key, value] of Object.entries(headerOverrides)) {
    if (value === undefined) delete headers[key];
    else headers[key] = value;
  }
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
}

async function call(
  method: string,
  params: Json,
  headerOverrides: Record<string, string | undefined> = {}
): Promise<{ status: number; body: Json }> {
  const response = await makeApp().request(eventsRequest(method, params, headerOverrides));
  return { status: response.status, body: (await response.json()) as Json };
}

const resultOf = (body: Json): Json => body.result as Json;
const errorOf = (body: Json): { code: number } => body.error as { code: number };

async function seedRun(id: string, workflow = 'wf-a', status = 'running'): Promise<void> {
  await pool.query(
    'INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ($1, $2, $3)',
    [`conv-${id}`, 'web', `web-${id}`]
  );
  await pool.query(
    'INSERT INTO remote_agent_workflow_runs (id, workflow_name, conversation_id, user_message, status) VALUES ($1, $2, $3, $4, $5)',
    [id, workflow, `conv-${id}`, 'go', status]
  );
}

const lastSeq = new Map<string, number>();
async function append(runId: string, status: string): Promise<void> {
  const previous = lastSeq.get(runId) ?? 0;
  const row = await appendStatusLogRow({
    workflow_run_id: runId,
    status,
    gate_key: null,
    data: { run_id: runId, status },
    previous_seq: previous,
  });
  if (!row) throw new Error('append lost');
  lastSeq.set(runId, row.seq);
}

beforeEach(async () => {
  await pool.query('DELETE FROM remote_agent_workflow_run_status_log');
  await pool.query('DELETE FROM remote_agent_workflow_runs');
  await pool.query('DELETE FROM remote_agent_conversations');
  lastSeq.clear();
  signal = new StatusLogSignal();
  fixedNow = undefined;
});

describe('events/list', () => {
  test('describes the one event type and needs no Mcp-Name', async () => {
    const { status, body } = await call('events/list', {});
    expect(status).toBe(200);
    const result = resultOf(body);
    expect(result.resultType).toBe('complete');
    const events = result.events as Json[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: STATUS_EVENT_NAME,
      description: 'Fires when an Archon workflow run changes status.',
      delivery: ['poll', 'push'],
      inputSchema: {
        type: 'object',
        properties: { run_id: { type: 'string', format: 'uuid' }, workflow: { type: 'string' } },
        additionalProperties: false,
      },
    });
  });
});

describe('events/poll', () => {
  test('cursor null returns no history and a fresh cursor', async () => {
    await seedRun('00000000-0000-4000-8000-000000000001');
    await append('00000000-0000-4000-8000-000000000001', 'running');
    const { body } = await call('events/poll', {
      name: STATUS_EVENT_NAME,
      arguments: {},
      cursor: null,
    });
    expect(resultOf(body)).toMatchObject({
      resultType: 'complete',
      events: [],
      cursor: 'v1:1',
      truncated: false,
      hasMore: false,
    });
  });

  test('returns appended rows in order with eventId <run>:<seq>', async () => {
    await seedRun('00000000-0000-4000-8000-000000000001');
    const start = resultOf(
      (await call('events/poll', { name: STATUS_EVENT_NAME, cursor: null })).body
    );
    await append('00000000-0000-4000-8000-000000000001', 'running');
    await append('00000000-0000-4000-8000-000000000001', 'paused');

    const result = resultOf(
      (
        await call('events/poll', {
          name: STATUS_EVENT_NAME,
          arguments: { run_id: '00000000-0000-4000-8000-000000000001' },
          cursor: start.cursor,
        })
      ).body
    );
    const events = result.events as {
      eventId: string;
      name: string;
      timestamp: string;
      data: Json;
    }[];
    expect(events.map(e => e.eventId)).toEqual([
      '00000000-0000-4000-8000-000000000001:1',
      '00000000-0000-4000-8000-000000000001:2',
    ]);
    expect(events[1]?.data).toEqual({
      run_id: '00000000-0000-4000-8000-000000000001',
      status: 'paused',
    });
    expect(events[0]?.name).toBe(STATUS_EVENT_NAME);
    expect(events[0]?.timestamp).toMatch(/Z$/);
    expect(result.cursor).toBe('v1:2');
    expect(result.nextPollMs).toBe(5000);
  });

  test('maxEvents caps the batch and sets hasMore with an intermediate cursor', async () => {
    await seedRun('00000000-0000-4000-8000-000000000001');
    await append('00000000-0000-4000-8000-000000000001', 'pending');
    await append('00000000-0000-4000-8000-000000000001', 'running');
    await append('00000000-0000-4000-8000-000000000001', 'completed');
    const result = resultOf(
      (await call('events/poll', { name: STATUS_EVENT_NAME, cursor: 'v1:0', maxEvents: 2 })).body
    );
    expect((result.events as unknown[]).length).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBe('v1:2');
  });

  test('maxAgeMs floors replay and reports truncated', async () => {
    await seedRun('00000000-0000-4000-8000-000000000001');
    await append('00000000-0000-4000-8000-000000000001', 'running');
    await append('00000000-0000-4000-8000-000000000001', 'paused');
    await pool.query(
      'UPDATE remote_agent_workflow_run_status_log SET created_at = $1 WHERE position = 1',
      ['2020-01-01T00:00:00.000Z']
    );
    const result = resultOf(
      (await call('events/poll', { name: STATUS_EVENT_NAME, cursor: 'v1:0', maxAgeMs: 60_000 }))
        .body
    );
    expect((result.events as { eventId: string }[]).map(e => e.eventId)).toEqual([
      '00000000-0000-4000-8000-000000000001:2',
    ]);
    expect(result.truncated).toBe(true);
  });

  test('a filtered poll with nothing new still advances the cursor', async () => {
    await seedRun('00000000-0000-4000-8000-000000000001');
    await seedRun('00000000-0000-4000-8000-000000000002', 'wf-b', 'completed');
    await append('00000000-0000-4000-8000-000000000002', 'completed');
    const result = resultOf(
      (
        await call('events/poll', {
          name: STATUS_EVENT_NAME,
          arguments: { run_id: '00000000-0000-4000-8000-000000000001' },
          cursor: 'v1:0',
        })
      ).body
    );
    expect(result.events).toEqual([]);
    expect(result.cursor).toBe('v1:1');
  });

  test('nextPollMs is 30000 when no matching run is active', async () => {
    await seedRun('00000000-0000-4000-8000-000000000002', 'wf-b', 'completed');
    const result = resultOf(
      (
        await call('events/poll', {
          name: STATUS_EVENT_NAME,
          arguments: { workflow: 'wf-b' },
          cursor: null,
        })
      ).body
    );
    expect(result.nextPollMs).toBe(30000);
  });

  test('a cursor that does not parse is -32602', async () => {
    const { body } = await call('events/poll', { name: STATUS_EVENT_NAME, cursor: 'garbage' });
    expect(errorOf(body).code).toBe(-32602);
  });

  test('a run_id argument that is not a run id is -32602', async () => {
    const { body } = await call('events/poll', {
      name: STATUS_EVENT_NAME,
      arguments: { run_id: 'not-a-run-id' },
      cursor: null,
    });
    expect(errorOf(body).code).toBe(-32602);
  });

  test('an unknown argument is -32602', async () => {
    const { body } = await call('events/poll', {
      name: STATUS_EVENT_NAME,
      arguments: { colour: 'red' },
      cursor: null,
    });
    expect(errorOf(body).code).toBe(-32602);
  });

  test('an unknown event name is -32023', async () => {
    const { body } = await call('events/poll', { name: 'no.such.event', cursor: null });
    expect(errorOf(body).code).toBe(-32023);
  });

  test('a missing or wrong Mcp-Name is 400 / -32020', async () => {
    const missing = await call(
      'events/poll',
      { name: STATUS_EVENT_NAME, cursor: null },
      { 'mcp-name': undefined }
    );
    expect(missing.status).toBe(400);
    expect(errorOf(missing.body).code).toBe(-32020);
    const wrong = await call(
      'events/poll',
      { name: STATUS_EVENT_NAME, cursor: null },
      { 'mcp-name': 'other' }
    );
    expect(wrong.status).toBe(400);
    expect(errorOf(wrong.body).code).toBe(-32020);
  });

  test('a wrong protocol-version or method header is 400 / -32020', async () => {
    const version = await call('events/list', {}, { 'mcp-protocol-version': '2025-06-18' });
    expect(version.status).toBe(400);
    expect(errorOf(version.body).code).toBe(-32020);
    const method = await call('events/list', {}, { 'mcp-method': 'events/poll' });
    expect(method.status).toBe(400);
  });

  test('an events method this server does not offer is method-not-found', async () => {
    const { body } = await call('events/subscribe', { name: STATUS_EVENT_NAME });
    expect(errorOf(body).code).toBe(-32601);
  });
});

interface Frame {
  method: string;
  params: Json & { _meta: Json };
}

class FrameReader {
  private buffer = '';
  private readonly decoder = new TextDecoder();

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  /** Next SSE `data:` frame, failing after `timeoutMs`. */
  async next(timeoutMs = 2000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const end = this.buffer.indexOf('\n\n');
      if (end >= 0) {
        const block = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        const data = block
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n');
        if (data) return JSON.parse(data) as Frame;
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for an SSE frame');
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timed out waiting for an SSE frame')), remaining)
        ),
      ]);
      if (chunk.done) throw new Error('stream ended');
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  /** Next frame whose method is `method`, skipping others. */
  async nextOf(method: string): Promise<Frame> {
    for (;;) {
      const frame = await this.next();
      if (frame.method === method) return frame;
    }
  }

  async close(): Promise<void> {
    await this.reader.cancel();
  }
}

async function openStream(
  params: Json
): Promise<{ reader: FrameReader; id: number; contentType: string | null }> {
  const id = nextId;
  const response = await makeApp().request(eventsRequest('events/stream', params));
  expect(response.status).toBe(200);
  if (!response.body) throw new Error('no body');
  return {
    reader: new FrameReader(response.body.getReader()),
    id,
    contentType: response.headers.get('content-type'),
  };
}

describe('events/stream', () => {
  test('sends active first, then live events and heartbeats, each with the subscription id', async () => {
    await seedRun('00000000-0000-4000-8000-000000000001');
    const { reader, id, contentType } = await openStream({
      name: STATUS_EVENT_NAME,
      arguments: { run_id: '00000000-0000-4000-8000-000000000001' },
      cursor: null,
    });
    expect(contentType).toContain('text/event-stream');

    const active = await reader.next();
    expect(active.method).toBe('notifications/events/active');
    expect(active.params).toMatchObject({ cursor: 'v1:0', truncated: false });
    expect(active.params._meta['io.modelcontextprotocol/subscriptionId']).toBe(id);

    await append('00000000-0000-4000-8000-000000000001', 'running');
    signal.notify();
    const event = await reader.nextOf('notifications/events/event');
    expect(event.params).toMatchObject({
      eventId: '00000000-0000-4000-8000-000000000001:1',
      name: STATUS_EVENT_NAME,
      cursor: 'v1:1',
    });
    expect(event.params._meta['io.modelcontextprotocol/subscriptionId']).toBe(id);

    const heartbeat = await reader.nextOf('notifications/events/heartbeat');
    expect(heartbeat.params.cursor).toBe('v1:1');
    expect(heartbeat.params._meta['io.modelcontextprotocol/subscriptionId']).toBe(id);
    await reader.close();
  });

  test('reconnecting with the last cursor delivers only later rows', async () => {
    await seedRun('00000000-0000-4000-8000-000000000001');
    await append('00000000-0000-4000-8000-000000000001', 'running');
    await append('00000000-0000-4000-8000-000000000001', 'paused');
    await append('00000000-0000-4000-8000-000000000001', 'running');
    const { reader } = await openStream({ name: STATUS_EVENT_NAME, cursor: 'v1:2' });
    expect((await reader.next()).method).toBe('notifications/events/active');
    const replayed = await reader.next();
    expect(replayed.params).toMatchObject({
      eventId: '00000000-0000-4000-8000-000000000001:3',
      cursor: 'v1:3',
    });
    expect((await reader.next()).method).toBe('notifications/events/heartbeat');
    await reader.close();
  });

  test('a cursor from a workflow-only poll streams a later run from seq 1', async () => {
    await seedRun(
      '00000000-0000-4000-8000-000000000003',
      'paseo-fork-upstream-resolve',
      'completed'
    );
    await append('00000000-0000-4000-8000-000000000003', 'completed');
    const bootstrap = resultOf(
      (
        await call('events/poll', {
          name: STATUS_EVENT_NAME,
          arguments: { workflow: 'paseo-fork-upstream-resolve' },
          cursor: null,
        })
      ).body
    );
    expect(bootstrap.cursor).toBe('v1:1');

    await seedRun('00000000-0000-4000-8000-000000000004', 'paseo-fork-upstream-resolve');
    await append('00000000-0000-4000-8000-000000000004', 'running');
    await append('00000000-0000-4000-8000-000000000004', 'paused');

    const { reader } = await openStream({
      name: STATUS_EVENT_NAME,
      arguments: { run_id: '00000000-0000-4000-8000-000000000004' },
      cursor: bootstrap.cursor,
    });
    expect((await reader.next()).method).toBe('notifications/events/active');
    expect((await reader.next()).params.eventId).toBe('00000000-0000-4000-8000-000000000004:1');
    expect((await reader.next()).params.eventId).toBe('00000000-0000-4000-8000-000000000004:2');
    await reader.close();
  });

  test('the active frame comes first even when rows arrive while the stream opens', async () => {
    await seedRun('00000000-0000-4000-8000-000000000001');
    await append('00000000-0000-4000-8000-000000000001', 'running');
    await append('00000000-0000-4000-8000-000000000001', 'paused');
    // A signal that fires the moment a stream subscribes, as an append racing the open would.
    const eager = new StatusLogSignal();
    const subscribe = eager.subscribe.bind(eager);
    eager.subscribe = (listener: () => void): (() => void) => {
      const unsubscribe = subscribe(listener);
      listener();
      return unsubscribe;
    };
    signal = eager;
    const { reader } = await openStream({ name: STATUS_EVENT_NAME, cursor: 'v1:0' });
    const first = await reader.next();
    expect(first.method).toBe('notifications/events/active');
    expect((await reader.next()).params.eventId).toBe('00000000-0000-4000-8000-000000000001:1');
    expect((await reader.next()).params.eventId).toBe('00000000-0000-4000-8000-000000000001:2');
    await reader.close();
  });

  test('an unknown event name is -32023 before any stream opens', async () => {
    const response = await makeApp().request(
      eventsRequest('events/stream', { name: 'nope', cursor: null })
    );
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(errorOf((await response.json()) as Json).code).toBe(-32023);
  });

  test('closing the stream removes its listener', async () => {
    await seedRun('00000000-0000-4000-8000-000000000001');
    const { reader } = await openStream({ name: STATUS_EVENT_NAME, cursor: null });
    await reader.next();
    expect(signal.listenerCount).toBe(1);
    await reader.close();
    for (let i = 0; i < 50 && signal.listenerCount > 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(signal.listenerCount).toBe(0);
  });
});

describe('routing', () => {
  test('non-events methods go to the SDK handler', async () => {
    const response = await makeApp().request(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
    );
    expect(response.status).toBe(418);
  });
});
