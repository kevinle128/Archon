/**
 * Events extension (`io.modelcontextprotocol/events`, SEP-3415 at b08e4f9)
 * for one event type, `workflow_run.status_changed`, backed by the durable
 * status log.
 *
 * - `eventId` = `<run_id>:<seq>`; `timestamp` = row `created_at`; `data` = row `data`.
 * - Cursor = `v1:<position>`, a global log position. It is valid for any
 *   subscription arguments, so a client can take a cursor with
 *   `events/poll {cursor: null}` before it starts a run and then stream that run
 *   from its first event. `cursor: null` (or absent) = start from now.
 * - Delivery: poll (`events/poll`) and push (`events/stream`, SSE). Webhook
 *   delivery is not offered.
 *
 * The SDK has no events support, so these methods are served here, in front
 * of the SDK handler (see `route.ts`).
 */
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from '@hono/zod-openapi';
import { createLogger } from '@archon/paths';
import * as workflowDb from '@archon/core/db/workflows';
import * as statusLogDb from '@archon/core/db/workflow-run-status-log';
import type {
  ListStatusLogRowsQuery,
  WorkflowRunStatusLogRow,
} from '@archon/core/db/workflow-run-status-log';

import { statusLogSignal, type StatusLogSignal } from './run-status-log';
import { isRunId } from './run-task';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('mcp.events');
  return cachedLog;
}

export const STATUS_EVENT_NAME = 'workflow_run.status_changed';
const SUBSCRIPTION_ID_META_KEY = 'io.modelcontextprotocol/subscriptionId';
const POLL_DEFAULT_MAX_EVENTS = 50;
const POLL_MAX_EVENTS = 200;
const STREAM_BATCH = 200;
const NEXT_POLL_ACTIVE_MS = 5_000;
const NEXT_POLL_IDLE_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 20_000;
const NON_TERMINAL_STATUSES = new Set(['pending', 'running', 'paused']);
/** `GET` window used to decide whether any matching run is still active. */
const ACTIVE_RUN_WINDOW = 200;

/** JSON-RPC error codes used by the events extension. */
export const EVENTS_ERROR_CODE = {
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  HeaderMismatch: -32020,
  NotFound: -32023,
} as const;

export const STATUS_EVENT_DESCRIPTOR = {
  name: STATUS_EVENT_NAME,
  description: 'Fires when an Archon workflow run changes status.',
  delivery: ['poll', 'push'],
  inputSchema: {
    type: 'object',
    properties: {
      run_id: { type: 'string', format: 'uuid', description: 'Only events of this run' },
      workflow: { type: 'string', description: 'Only events of runs of this workflow' },
    },
    additionalProperties: false,
  },
  payloadSchema: {
    type: 'object',
    properties: {
      run_id: { type: 'string' },
      workflow: { type: 'string' },
      status: {
        type: 'string',
        enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'],
      },
      task_status: {
        type: 'string',
        enum: ['working', 'input_required', 'completed', 'failed', 'cancelled'],
      },
      node: { type: 'string' },
      question: { type: 'string' },
      pr_url: { type: 'string' },
      ci: {
        type: 'object',
        properties: {
          conclusion: { type: 'string' },
          failed: { type: 'array', items: { type: 'string' } },
          checks_url: { type: 'string' },
        },
      },
      url: { type: 'string' },
      error: { type: 'string' },
    },
    required: ['run_id', 'workflow', 'status', 'task_status', 'url'],
  },
} as const;

/** Read access the events methods need. */
export interface EventsStore {
  getMaxPosition(): Promise<number>;
  listRows(query: ListStatusLogRowsQuery): Promise<WorkflowRunStatusLogRow[]>;
  /** Whether a run matching the filter is not terminal. */
  hasActiveRun(filter: { runId?: string; workflow?: string }): Promise<boolean>;
}

export function createDbEventsStore(): EventsStore {
  return {
    getMaxPosition: statusLogDb.getMaxStatusLogPosition,
    listRows: statusLogDb.listStatusLogRows,
    async hasActiveRun(filter: { runId?: string; workflow?: string }): Promise<boolean> {
      if (filter.runId !== undefined) {
        const run = await workflowDb.getWorkflowRun(filter.runId);
        return run !== null && NON_TERMINAL_STATUSES.has(run.status);
      }
      const runs = await workflowDb.listWorkflowRuns({
        status: ['pending', 'running', 'paused'],
        limit: ACTIVE_RUN_WINDOW,
      });
      return runs.some(r => filter.workflow === undefined || r.workflow_name === filter.workflow);
    },
  };
}

export interface EventsDeps {
  store: EventsStore;
  signal: StatusLogSignal;
  heartbeatMs?: number;
  now?: () => number;
}

export function defaultEventsDeps(): EventsDeps {
  return { store: createDbEventsStore(), signal: statusLogSignal };
}

type JsonRpcId = string | number;

export interface JsonRpcRequestMessage {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

class EventsError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EventsError';
  }
}

export function jsonRpcError(
  httpStatus: number,
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: Record<string, unknown>
): Response {
  return Response.json(
    { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } },
    { status: httpStatus }
  );
}

function jsonRpcResult(id: JsonRpcId, result: Record<string, unknown>): Response {
  return Response.json({ jsonrpc: '2.0', id, result: { resultType: 'complete', ...result } });
}

export function encodeCursor(position: number): string {
  return `v1:${String(position)}`;
}

/** Parse `v1:<position>`; throws InvalidParams for anything else. */
export function decodeCursor(cursor: string): number {
  const match = /^v1:(\d{1,15})$/.exec(cursor);
  if (!match?.[1])
    throw new EventsError(EVENTS_ERROR_CODE.InvalidParams, `Invalid cursor: ${cursor}`);
  return Number(match[1]);
}

const argumentsSchema = z
  .object({
    run_id: z.string().refine(isRunId, { message: 'run_id must be a run id (UUID)' }).optional(),
    workflow: z.string().min(1).max(255).optional(),
  })
  .strict();

const subscriptionParamsSchema = z
  .object({
    name: z.string().min(1),
    arguments: z.unknown().optional(),
    cursor: z.string().nullable().optional(),
    maxAgeMs: z.number().int().nonnegative().optional(),
    maxEvents: z.number().int().positive().optional(),
  })
  .loose();

interface Subscription {
  runId?: string;
  workflow?: string;
  /** Decoded cursor, or null for "start from now". */
  after: number | null;
  maxAgeMs?: number;
  maxEvents?: number;
}

function parseSubscription(params: unknown): Subscription {
  const parsed = subscriptionParamsSchema.safeParse(params ?? {});
  if (!parsed.success) {
    throw new EventsError(
      EVENTS_ERROR_CODE.InvalidParams,
      `Invalid params: ${parsed.error.message}`
    );
  }
  if (parsed.data.name !== STATUS_EVENT_NAME) {
    throw new EventsError(EVENTS_ERROR_CODE.NotFound, `Unknown event: ${parsed.data.name}`, {
      kind: 'event',
    });
  }
  const args = argumentsSchema.safeParse(parsed.data.arguments ?? {});
  if (!args.success) {
    throw new EventsError(
      EVENTS_ERROR_CODE.InvalidParams,
      `Invalid arguments: ${args.error.message}`
    );
  }
  const cursor = parsed.data.cursor;
  return {
    ...(args.data.run_id !== undefined ? { runId: args.data.run_id } : {}),
    ...(args.data.workflow !== undefined ? { workflow: args.data.workflow } : {}),
    after: cursor === null || cursor === undefined ? null : decodeCursor(cursor),
    ...(parsed.data.maxAgeMs !== undefined ? { maxAgeMs: parsed.data.maxAgeMs } : {}),
    ...(parsed.data.maxEvents !== undefined ? { maxEvents: parsed.data.maxEvents } : {}),
  };
}

function filterOf(sub: Subscription): Pick<ListStatusLogRowsQuery, 'runId' | 'workflow'> {
  return {
    ...(sub.runId !== undefined ? { runId: sub.runId } : {}),
    ...(sub.workflow !== undefined ? { workflow: sub.workflow } : {}),
  };
}

interface EventOccurrence {
  eventId: string;
  name: string;
  timestamp: string;
  data: Record<string, unknown>;
  cursor?: string;
}

function toOccurrence(row: WorkflowRunStatusLogRow, withCursor: boolean): EventOccurrence {
  return {
    eventId: `${row.workflow_run_id}:${String(row.seq)}`,
    name: STATUS_EVENT_NAME,
    timestamp: row.created_at,
    data: row.data,
    ...(withCursor ? { cursor: encodeCursor(row.position) } : {}),
  };
}

/**
 * Replay floor for `maxAgeMs`: delivery starts at the later of the cursor and
 * `now - maxAgeMs`. Returns the ISO floor and whether it skipped any row.
 */
async function replayFloor(
  deps: EventsDeps,
  sub: Subscription,
  after: number,
  through: number
): Promise<{ since?: string; truncated: boolean }> {
  if (sub.maxAgeMs === undefined) return { truncated: false };
  const now = deps.now ? deps.now() : Date.now();
  const since = new Date(now - sub.maxAgeMs).toISOString();
  const skipped = await deps.store.listRows({
    after,
    through,
    ...filterOf(sub),
    before: since,
    limit: 1,
  });
  return { since, truncated: skipped.length > 0 };
}

function listResult(id: JsonRpcId): Response {
  return jsonRpcResult(id, { events: [STATUS_EVENT_DESCRIPTOR] });
}

async function pollResult(deps: EventsDeps, id: JsonRpcId, params: unknown): Promise<Response> {
  const sub = parseSubscription(params);
  const maxEvents = Math.min(sub.maxEvents ?? POLL_DEFAULT_MAX_EVENTS, POLL_MAX_EVENTS);
  const maxPosition = await deps.store.getMaxPosition();
  const nextPollMs = (await deps.store.hasActiveRun(filterOf(sub)))
    ? NEXT_POLL_ACTIVE_MS
    : NEXT_POLL_IDLE_MS;

  if (sub.after === null) {
    return jsonRpcResult(id, {
      events: [],
      cursor: encodeCursor(maxPosition),
      truncated: false,
      hasMore: false,
      nextPollMs,
    });
  }

  const after = sub.after;
  const floor = await replayFloor(deps, sub, after, maxPosition);
  const rows = await deps.store.listRows({
    after,
    through: maxPosition,
    ...filterOf(sub),
    ...(floor.since !== undefined ? { since: floor.since } : {}),
    limit: maxEvents + 1,
  });
  const hasMore = rows.length > maxEvents;
  const batch = hasMore ? rows.slice(0, maxEvents) : rows;
  const last = batch.at(-1);
  // Every row up to maxPosition was examined when nothing is left, so the cursor
  // may advance to it even for a filtered subscription.
  const cursor = hasMore && last ? last.position : Math.max(after, maxPosition);
  return jsonRpcResult(id, {
    events: batch.map(row => toOccurrence(row, false)),
    cursor: encodeCursor(cursor),
    truncated: floor.truncated,
    hasMore,
    nextPollMs,
  });
}

function streamResponse(
  c: Context,
  deps: EventsDeps,
  id: JsonRpcId,
  sub: Subscription,
  start: { after: number; since?: string; truncated: boolean }
): Response {
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const meta = { [SUBSCRIPTION_ID_META_KEY]: id };
  const frame = (method: string, params: Record<string, unknown>): string =>
    JSON.stringify({ jsonrpc: '2.0', method, params: { ...params, _meta: meta } });

  return streamSSE(c, async stream => {
    let delivered = start.after;
    let checked = start.after;
    let chain: Promise<void> = Promise.resolve();
    let closed = false;

    const flushOnce = async (): Promise<void> => {
      for (;;) {
        if (closed) return;
        const through = await deps.store.getMaxPosition();
        const rows = await deps.store.listRows({
          after: delivered,
          through,
          ...filterOf(sub),
          ...(start.since !== undefined ? { since: start.since } : {}),
          limit: STREAM_BATCH,
        });
        for (const row of rows) {
          if (closed) return;
          await stream.writeSSE({
            data: frame('notifications/events/event', { ...toOccurrence(row, true) }),
          });
          delivered = row.position;
        }
        if (rows.length < STREAM_BATCH) {
          delivered = Math.max(delivered, through);
          checked = Math.max(checked, through);
          return;
        }
      }
    };

    const flush = (): Promise<void> => {
      chain = chain.then(flushOnce).catch(async (error: unknown) => {
        getLog().error(
          { err: error as Error, subscriptionId: id },
          'mcp.events_stream_flush_failed'
        );
        if (!closed) {
          await stream
            .writeSSE({
              data: frame('notifications/events/error', {
                error: { code: EVENTS_ERROR_CODE.InternalError, message: 'Failed to read events' },
              }),
            })
            .catch(() => undefined);
        }
      });
      return chain;
    };

    let onAborted: () => void = () => undefined;
    const aborted = new Promise<undefined>(resolve => {
      onAborted = (): void => {
        resolve(undefined);
      };
    });
    /** Removes the signal listener and the heartbeat once they are attached. */
    let detach: () => void = () => undefined;
    stream.onAbort(() => {
      closed = true;
      detach();
      getLog().debug({ subscriptionId: id }, 'mcp.events_stream_closed');
      onAborted();
    });

    // `active` must be the first frame, so nothing that can flush (the signal
    // listener, the heartbeat) is attached until it has been written.
    await stream.writeSSE({
      data: frame('notifications/events/active', {
        cursor: encodeCursor(start.after),
        truncated: start.truncated,
      }),
    });
    if (closed) return;
    const unsubscribe = deps.signal.subscribe(() => {
      void flush();
    });
    const heartbeat = setInterval(() => {
      void flush().then(async () => {
        if (closed) return;
        await stream
          .writeSSE({
            data: frame('notifications/events/heartbeat', { cursor: encodeCursor(checked) }),
          })
          .catch(() => undefined);
      });
    }, heartbeatMs);
    detach = (): void => {
      unsubscribe();
      clearInterval(heartbeat);
    };
    await flush();
    getLog().debug({ subscriptionId: id, cursor: start.after }, 'mcp.events_stream_opened');
    // The subscription stays open after a terminal event; the client ends it by
    // closing the request.
    await aborted;
  });
}

async function streamResult(
  c: Context,
  deps: EventsDeps,
  id: JsonRpcId,
  params: unknown
): Promise<Response> {
  const sub = parseSubscription(params);
  const maxPosition = await deps.store.getMaxPosition();
  if (sub.after === null) {
    return streamResponse(c, deps, id, sub, { after: maxPosition, truncated: false });
  }
  const floor = await replayFloor(deps, sub, sub.after, maxPosition);
  return streamResponse(c, deps, id, sub, {
    after: sub.after,
    ...(floor.since !== undefined ? { since: floor.since } : {}),
    truncated: floor.truncated,
  });
}

/** Methods whose `Mcp-Name` header must mirror `params.name`. */
const NAME_HEADER_METHODS = new Set(['events/poll', 'events/stream']);
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

function headerMismatch(id: JsonRpcId | null, header: string, body: string): Response {
  return jsonRpcError(
    400,
    id,
    EVENTS_ERROR_CODE.HeaderMismatch,
    `Bad Request: the request headers and body disagree: ${body}`,
    { mismatch: { header, body } }
  );
}

/** Standard-header checks the SDK applies to its own methods, applied to `events/*`. */
function checkHeaders(c: Context, message: JsonRpcRequestMessage): Response | undefined {
  const version = c.req.header('mcp-protocol-version');
  if (version !== MODERN_PROTOCOL_VERSION) {
    return headerMismatch(
      message.id,
      version ?? '(missing)',
      `the required MCP-Protocol-Version header must be ${MODERN_PROTOCOL_VERSION}`
    );
  }
  const methodHeader = c.req.header('mcp-method');
  if (methodHeader?.trim() !== message.method) {
    return headerMismatch(
      message.id,
      methodHeader ?? '(missing)',
      `the body names method ${message.method} but the Mcp-Method header does not`
    );
  }
  if (NAME_HEADER_METHODS.has(message.method)) {
    const params = message.params;
    const bodyName =
      params !== null && typeof params === 'object' && 'name' in params
        ? (params as { name: unknown }).name
        : undefined;
    const nameHeader = c.req.header('mcp-name')?.trim();
    if (typeof bodyName === 'string' && nameHeader !== bodyName) {
      return headerMismatch(
        message.id,
        nameHeader ?? '(missing)',
        `the body carries params.name="${bodyName}" but the Mcp-Name header ${nameHeader === undefined ? 'is absent' : `names "${nameHeader}"`}`
      );
    }
  }
  return undefined;
}

/** Serve one `events/*` JSON-RPC request. */
export async function handleEventsRequest(
  c: Context,
  message: JsonRpcRequestMessage,
  deps: EventsDeps
): Promise<Response> {
  const rejected = checkHeaders(c, message);
  if (rejected) return rejected;
  try {
    switch (message.method) {
      case 'events/list':
        return listResult(message.id);
      case 'events/poll':
        return await pollResult(deps, message.id, message.params);
      case 'events/stream':
        return await streamResult(c, deps, message.id, message.params);
      default:
        return jsonRpcError(
          404,
          message.id,
          EVENTS_ERROR_CODE.MethodNotFound,
          `Method not found: ${message.method}`
        );
    }
  } catch (error) {
    if (error instanceof EventsError) {
      return jsonRpcError(200, message.id, error.code, error.message, error.data);
    }
    getLog().error({ err: error as Error, method: message.method }, 'mcp.events_request_failed');
    return jsonRpcError(200, message.id, EVENTS_ERROR_CODE.InternalError, 'Internal error');
  }
}
