/**
 * In-process client for the Archon REST API, used by the MCP handlers.
 *
 * Every call goes through the real `/api/*` routes with the MCP caller's auth
 * headers, so request validation, the access gate, identity attribution, and
 * side effects (message persistence, auto-resume after approve) stay in one
 * place. Responses are validated here, at the boundary, and reduced to the
 * snapshot shapes `run-task.ts` maps.
 */
import { z } from '@hono/zod-openapi';

import { toIsoTimestamp, type RunEventSnapshot, type RunSnapshot } from './run-task';

/** Sends one request to the Archon app (in production: `app.request`). */
export type ApiRequester = (path: string, init: RequestInit) => Promise<Response>;

/** A REST call answered with a non-2xx status. `message` is the route's `error` text. */
export class ArchonApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ArchonApiError';
  }
}

const codebaseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    repository_url: z.string().nullable().optional(),
    default_cwd: z.string(),
  })
  .loose();
export type ApiCodebase = z.infer<typeof codebaseSchema>;

const workflowListSchema = z
  .object({
    workflows: z.array(
      z
        .object({
          workflow: z.object({ name: z.string(), returns: z.string().optional() }).loose(),
        })
        .loose()
    ),
  })
  .loose();

export interface ApiWorkflow {
  name: string;
  returns?: string;
}

const createConversationSchema = z.object({ conversationId: z.string(), id: z.string() }).loose();
const dispatchSchema = z
  .object({ accepted: z.boolean(), status: z.string(), runId: z.string().optional() })
  .loose();
export type ApiDispatch = z.infer<typeof dispatchSchema>;

const timestampSchema = z.union([z.string(), z.null()]).optional();
const runSchema = z
  .object({
    id: z.string(),
    workflow_name: z.string(),
    status: z.string(),
    codebase_id: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    started_at: timestampSchema,
    completed_at: timestampSchema,
    last_activity_at: timestampSchema,
  })
  .loose();

const eventSchema = z
  .object({
    event_type: z.string(),
    step_name: z.string().nullable().optional(),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: timestampSchema,
  })
  .loose();

const runDetailSchema = z.object({ run: runSchema, events: z.array(eventSchema) }).loose();
const runListSchema = z.object({ runs: z.array(runSchema) }).loose();
const messageListSchema = z.array(
  z.object({ role: z.string(), content: z.string(), created_at: z.string().optional() }).loose()
);
export type ApiMessage = z.infer<typeof messageListSchema>[number];

export interface RunDetail {
  run: RunSnapshot;
  codebaseId: string | null;
  events: RunEventSnapshot[];
}

function toRunSnapshot(raw: z.infer<typeof runSchema>): RunSnapshot {
  return {
    id: raw.id,
    workflow_name: raw.workflow_name,
    status: raw.status,
    metadata: raw.metadata ?? {},
    started_at: toIsoTimestamp(raw.started_at),
    completed_at: toIsoTimestamp(raw.completed_at),
    last_activity_at: toIsoTimestamp(raw.last_activity_at),
  };
}

function toEventSnapshot(raw: z.infer<typeof eventSchema>): RunEventSnapshot {
  return {
    event_type: raw.event_type,
    step_name: raw.step_name ?? null,
    data: raw.data ?? {},
    created_at: toIsoTimestamp(raw.created_at),
  };
}

/** Headers the `/api/*` gate and identity resolution read. */
function identityHeaderNames(): string[] {
  const proxyHeader = (process.env.ARCHON_WEB_AUTH_HEADER || 'X-Archon-User').toLowerCase();
  return ['cookie', 'authorization', proxyHeader];
}

/** Copy only the caller's identity headers; never forward MCP transport headers. */
export function forwardedAuthHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const name of identityHeaderNames()) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export interface ArchonApi {
  listCodebases(): Promise<ApiCodebase[]>;
  getCodebase(id: string): Promise<ApiCodebase | null>;
  listWorkflows(cwd: string): Promise<ApiWorkflow[]>;
  createConversation(codebaseId: string): Promise<{ conversationId: string }>;
  startRun(
    workflow: string,
    body: { conversationId: string; message: string; runId: string }
  ): Promise<ApiDispatch>;
  getRunDetail(runId: string): Promise<RunDetail | null>;
  listRuns(query: { status?: string; limit: number }): Promise<RunSnapshot[]>;
  approve(runId: string, comment?: string): Promise<void>;
  reject(runId: string, reason: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  getConversationMessages(conversationId: string): Promise<ApiMessage[]>;
}

export function createArchonApi(request: ApiRequester, authHeaders: Headers): ArchonApi {
  async function call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<{ status: number; json: unknown }> {
    const headers = new Headers(authHeaders);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await request(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    return { status: response.status, json };
  }

  function errorText(json: unknown, fallback: string): string {
    if (json !== null && typeof json === 'object' && 'error' in json) {
      const error = (json as { error: unknown }).error;
      if (typeof error === 'string' && error.length > 0) return error;
    }
    return fallback;
  }

  async function expectOk<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown
  ): Promise<T> {
    const { status, json } = await call(method, path, body);
    if (status < 200 || status >= 300) {
      throw new ArchonApiError(
        status,
        errorText(json, `${method} ${path} failed with ${String(status)}`)
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ArchonApiError(502, `${method} ${path} returned an unexpected body`);
    }
    return parsed.data;
  }

  async function expectOkOrNull<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    const { status, json } = await call('GET', path);
    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      throw new ArchonApiError(
        status,
        errorText(json, `GET ${path} failed with ${String(status)}`)
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ArchonApiError(502, `GET ${path} returned an unexpected body`);
    return parsed.data;
  }

  const runPath = (runId: string): string => `/api/workflows/runs/${encodeURIComponent(runId)}`;
  const anyBody = z.unknown();

  return {
    async listCodebases(): Promise<ApiCodebase[]> {
      return expectOk('GET', '/api/codebases', z.array(codebaseSchema));
    },
    async getCodebase(id: string): Promise<ApiCodebase | null> {
      return expectOkOrNull(`/api/codebases/${encodeURIComponent(id)}`, codebaseSchema);
    },
    async listWorkflows(cwd: string): Promise<ApiWorkflow[]> {
      const list = await expectOk(
        'GET',
        `/api/workflows?cwd=${encodeURIComponent(cwd)}`,
        workflowListSchema
      );
      return list.workflows.map(entry => ({
        name: entry.workflow.name,
        ...(entry.workflow.returns !== undefined ? { returns: entry.workflow.returns } : {}),
      }));
    },
    async createConversation(codebaseId: string): Promise<{ conversationId: string }> {
      const created = await expectOk('POST', '/api/conversations', createConversationSchema, {
        codebaseId,
      });
      return { conversationId: created.conversationId };
    },
    async startRun(
      workflow: string,
      body: { conversationId: string; message: string; runId: string }
    ): Promise<ApiDispatch> {
      return expectOk(
        'POST',
        `/api/workflows/${encodeURIComponent(workflow)}/run`,
        dispatchSchema,
        body
      );
    },
    async getRunDetail(runId: string): Promise<RunDetail | null> {
      const detail = await expectOkOrNull(runPath(runId), runDetailSchema);
      if (!detail) return null;
      return {
        run: toRunSnapshot(detail.run),
        codebaseId: detail.run.codebase_id ?? null,
        events: detail.events.map(toEventSnapshot),
      };
    },
    async listRuns(query: { status?: string; limit: number }): Promise<RunSnapshot[]> {
      const params = new URLSearchParams({ limit: String(query.limit) });
      if (query.status) params.set('status', query.status);
      const list = await expectOk('GET', `/api/workflows/runs?${params.toString()}`, runListSchema);
      return list.runs.map(toRunSnapshot);
    },
    async approve(runId: string, comment?: string): Promise<void> {
      await expectOk('POST', `${runPath(runId)}/approve`, anyBody, comment ? { comment } : {});
    },
    async reject(runId: string, reason: string): Promise<void> {
      await expectOk('POST', `${runPath(runId)}/reject`, anyBody, { reason });
    },
    async cancel(runId: string): Promise<void> {
      await expectOk('POST', `${runPath(runId)}/cancel`, anyBody, {});
    },
    async getConversationMessages(conversationId: string): Promise<ApiMessage[]> {
      return expectOk(
        'GET',
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        messageListSchema
      );
    },
  };
}
