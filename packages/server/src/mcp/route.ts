/**
 * `/mcp` endpoint: MCP Streamable HTTP, protocol revision 2026-07-28.
 *
 * Registered with plain `app.use`/`app.all`, not `registerOpenApiRoute`: the
 * endpoint speaks JSON-RPC (and SSE for `events/stream`), not a REST JSON
 * contract that OpenAPI can describe.
 *
 * Order of checks:
 * 1. The same access gate instance that protects `/api/*` (identity required
 *    when web auth is on).
 * 2. Origin: no `Origin` header → allowed (non-browser clients); otherwise it
 *    must be the `ARCHON_PUBLIC_URL` origin or a loopback origin, else 403.
 *    This blocks DNS-rebinding and cross-site browser requests.
 * 3. `events/*` requests go to `events.ts`; everything else to the SDK handler.
 */
import type { MiddlewareHandler } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { createLogger } from '@archon/paths';

import { createArchonApi, forwardedAuthHeaders } from './archon-api';
import {
  defaultEventsDeps,
  handleEventsRequest,
  jsonRpcError,
  type EventsDeps,
  type JsonRpcRequestMessage,
} from './events';
import { createMcpServerHandler } from './server-factory';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('mcp.route');
  return cachedLog;
}

export const MCP_PATH = '/mcp';
/** Same bound as the SDK's default for POST bodies it reads itself. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface McpRouteDeps {
  /** The middleware that gates `/api/*`; applied unchanged to `/mcp`. */
  accessGate: MiddlewareHandler;
  /** Overrides for tests; production builds both from `app`. */
  mcpHandler?: McpHttpHandler;
  events?: EventsDeps;
}

function configuredPublicOrigin(): string | undefined {
  const configured = process.env.ARCHON_PUBLIC_URL?.trim();
  if (!configured) return undefined;
  try {
    return new URL(configured).origin;
  } catch {
    getLog().warn({ value: configured }, 'mcp.public_url_invalid');
    return undefined;
  }
}

/** `ARCHON_PUBLIC_URL` without a trailing slash, or undefined when unset. */
export function configuredBaseUrl(): string | undefined {
  const configured = process.env.ARCHON_PUBLIC_URL?.trim();
  return configured ? configured.replace(/\/+$/, '') : undefined;
}

/** Web UI base URL: `ARCHON_PUBLIC_URL` when set, else the request's origin. */
export function publicBaseUrl(request: Request): string {
  return configuredBaseUrl() ?? new URL(request.url).origin;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === configuredPublicOrigin()) return true;
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    LOOPBACK_HOSTS.has(parsed.hostname)
  );
}

function isEventsRequest(body: unknown): body is JsonRpcRequestMessage {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const message = body as Record<string, unknown>;
  return (
    typeof message.method === 'string' &&
    message.method.startsWith('events/') &&
    (typeof message.id === 'string' || typeof message.id === 'number')
  );
}

export function registerMcpRoute(app: OpenAPIHono, deps: McpRouteDeps): void {
  const mcpHandler =
    deps.mcpHandler ??
    createMcpServerHandler({
      apiFor: request =>
        createArchonApi(
          async (path, init) => app.request(path, init),
          forwardedAuthHeaders(request.headers)
        ),
      baseUrlFor: publicBaseUrl,
    });
  const eventsDeps = deps.events ?? defaultEventsDeps();

  app.use(MCP_PATH, deps.accessGate);
  app.all(MCP_PATH, async c => {
    const origin = c.req.header('origin');
    if (!isAllowedOrigin(origin)) {
      getLog().warn({ origin }, 'mcp.origin_rejected');
      return c.json({ error: 'Origin not allowed' }, 403);
    }

    if (c.req.method !== 'POST') return mcpHandler.fetch(c.req.raw);

    const declaredLength = Number(c.req.header('content-length') ?? '0');
    if (declaredLength > MAX_BODY_BYTES) {
      return jsonRpcError(413, null, -32600, 'Request body too large');
    }
    const text = await c.req.text();
    if (text.length > MAX_BODY_BYTES) {
      return jsonRpcError(413, null, -32600, 'Request body too large');
    }

    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // Let the SDK answer malformed JSON with its own parse error.
      return mcpHandler.fetch(
        new Request(c.req.url, { method: 'POST', headers: c.req.raw.headers, body: text })
      );
    }

    if (isEventsRequest(body)) return handleEventsRequest(c, body, eventsDeps);
    return mcpHandler.fetch(c.req.raw, { parsedBody: body });
  });
}
