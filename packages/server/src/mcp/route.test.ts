import { afterEach, describe, expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import type { McpHttpHandler } from '@modelcontextprotocol/server';

import { StatusLogSignal } from './run-status-log';
import { isAllowedOrigin, publicBaseUrl, registerMcpRoute } from './route';
import type { EventsStore } from './events';

const originalPublicUrl = process.env.ARCHON_PUBLIC_URL;
afterEach(() => {
  if (originalPublicUrl === undefined) delete process.env.ARCHON_PUBLIC_URL;
  else process.env.ARCHON_PUBLIC_URL = originalPublicUrl;
});

interface SdkCall {
  method: string;
  parsedBody: unknown;
  bodyText: string | null;
}

function makeApp(gate: MiddlewareHandler = async (_c, next) => next()): {
  app: OpenAPIHono;
  sdkCalls: SdkCall[];
} {
  const sdkCalls: SdkCall[] = [];
  const sdk = {
    fetch: async (request: Request, options?: { parsedBody?: unknown }) => {
      const bodyText =
        options?.parsedBody === undefined && request.body ? await request.text() : null;
      sdkCalls.push({ method: request.method, parsedBody: options?.parsedBody, bodyText });
      return new Response('sdk', { status: 299 });
    },
  } as unknown as McpHttpHandler;
  const store: EventsStore = {
    getMaxPosition: async () => 0,
    listRows: async () => [],
    hasActiveRun: async () => false,
  };
  const app = new OpenAPIHono();
  registerMcpRoute(app, {
    accessGate: gate,
    mcpHandler: sdk,
    events: { store, signal: new StatusLogSignal() },
  });
  return { app, sdkCalls };
}

function post(
  headers: Record<string, string> = {},
  body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body };
}

describe('isAllowedOrigin', () => {
  test('allows a request without Origin and loopback origins', () => {
    delete process.env.ARCHON_PUBLIC_URL;
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3090')).toBe(true);
    expect(isAllowedOrigin('https://[::1]:3090')).toBe(true);
  });

  test('allows the ARCHON_PUBLIC_URL origin and rejects others', () => {
    process.env.ARCHON_PUBLIC_URL = 'https://archon.example.ts.net/some/path';
    expect(isAllowedOrigin('https://archon.example.ts.net')).toBe(true);
    expect(isAllowedOrigin('http://archon.example.ts.net')).toBe(false);
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedOrigin('null')).toBe(false);
  });
});

describe('publicBaseUrl', () => {
  test('uses ARCHON_PUBLIC_URL without a trailing slash, else the request origin', () => {
    process.env.ARCHON_PUBLIC_URL = 'https://archon.example.ts.net/';
    expect(publicBaseUrl(new Request('http://127.0.0.1:3090/mcp'))).toBe(
      'https://archon.example.ts.net'
    );
    delete process.env.ARCHON_PUBLIC_URL;
    expect(publicBaseUrl(new Request('http://127.0.0.1:3090/mcp'))).toBe('http://127.0.0.1:3090');
  });
});

describe('/mcp route', () => {
  test('a request without Origin reaches the SDK handler with the parsed body', async () => {
    const { app, sdkCalls } = makeApp();
    const response = await app.request('/mcp', post());
    expect(response.status).toBe(299);
    expect(sdkCalls[0]?.parsedBody).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  });

  test('a foreign Origin is rejected with 403 before any handler runs', async () => {
    delete process.env.ARCHON_PUBLIC_URL;
    const { app, sdkCalls } = makeApp();
    const response = await app.request('/mcp', post({ origin: 'https://evil.example.com' }));
    expect(response.status).toBe(403);
    expect(sdkCalls).toHaveLength(0);
  });

  test('a loopback Origin is allowed', async () => {
    const { app } = makeApp();
    const response = await app.request('/mcp', post({ origin: 'http://localhost:5173' }));
    expect(response.status).toBe(299);
  });

  test('the access gate runs first', async () => {
    const deny: MiddlewareHandler = async c => c.json({ error: 'Authentication required' }, 401);
    const { app, sdkCalls } = makeApp(deny);
    const response = await app.request('/mcp', post());
    expect(response.status).toBe(401);
    expect(sdkCalls).toHaveLength(0);
  });

  test('events/* requests are served by the events module, not the SDK', async () => {
    const { app, sdkCalls } = makeApp();
    const response = await app.request(
      '/mcp',
      post(
        { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'events/list' },
        '{"jsonrpc":"2.0","id":7,"method":"events/list","params":{}}'
      )
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: number }).id).toBe(7);
    expect(sdkCalls).toHaveLength(0);
  });

  test('malformed JSON is passed to the SDK unparsed so it answers with its own error', async () => {
    const { app, sdkCalls } = makeApp();
    await app.request('/mcp', post({}, '{not json'));
    expect(sdkCalls[0]?.parsedBody).toBeUndefined();
    expect(sdkCalls[0]?.bodyText).toBe('{not json');
  });

  test('GET goes to the SDK handler (which answers 405)', async () => {
    const { app, sdkCalls } = makeApp();
    await app.request('/mcp', { method: 'GET' });
    expect(sdkCalls[0]?.method).toBe('GET');
  });

  test('an oversized body is refused with 413', async () => {
    const { app, sdkCalls } = makeApp();
    const response = await app.request('/mcp', post({}, 'x'.repeat(4 * 1024 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(sdkCalls).toHaveLength(0);
  });
});
