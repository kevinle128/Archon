import assert from 'node:assert/strict';
import { env } from 'node:process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';
import { z } from '@hono/zod-openapi';
import { TOOLING_REPO, writeJson } from './io';
import type { ScenarioResult } from './contract';
import type { ArchonRuntime } from '../../../../e2e/lib/playwright/archon-runtime';

const PROTOCOL = '2026-07-28';
const TASKS = 'io.modelcontextprotocol/tasks';
const EVENTS = 'io.modelcontextprotocol/events';

const clientMeta = {
  'io.modelcontextprotocol/protocolVersion': PROTOCOL,
  'io.modelcontextprotocol/clientInfo': { name: 'verify-archon', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {
    extensions: { [TASKS]: {}, [EVENTS]: {} },
  },
};

const rpcMessageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).passthrough().optional(),
}).passthrough();

type RpcMessage = z.infer<typeof rpcMessageSchema>;

function rpcBody(id: number, method: string, params: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params: { ...params, _meta: clientMeta },
  });
}

/** The SDK may answer with one JSON body or one SSE `data:` frame. */
function parseRpc(text: string): RpcMessage {
  const trimmed = text.trim();
  const json = trimmed.startsWith('{')
    ? trimmed
    : trimmed.split('\n').map(line => line.startsWith('data:') ? line.slice(5).trim() : '').filter(line => line.startsWith('{')).at(-1);
  if (!json) throw new Error(`MCP response was not JSON-RPC: ${trimmed.slice(0, 400)}`);
  return rpcMessageSchema.parse(JSON.parse(json));
}

/**
 * Drive POST /mcp on the isolated e2e server.
 * The runtime module is imported only for this scenario, matching api-scenario.ts,
 * so doctor and catalog do not load the Playwright runtime.
 */
export async function runMcpScenario(repo: string, id: string, evidence: string): Promise<ScenarioResult> {
  env.ARCHON_E2E_REPO_ROOT = repo;
  env.ARCHON_E2E_PORT_BASE = '13400';
  const runtimeModule: typeof import('../../../../e2e/lib/playwright/archon-runtime') =
    await import(pathToFileURL(join(TOOLING_REPO, 'e2e/lib/playwright/archon-runtime.ts')).href);
  const transcript: unknown[] = [];
  const errors: string[] = [];
  let runtime: ArchonRuntime | undefined;
  let cleaned = false;
  const attachment = `${id}.json`;
  try {
    runtime = await runtimeModule.createArchonRuntime(0);
    const active = runtime;
    const call = async (
      method: string,
      params: Record<string, unknown>,
      headers: Record<string, string>,
      status: number,
    ): Promise<RpcMessage> => {
      const body = rpcBody(1, method, params);
      const response = await fetch(active.baseURL + '/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-Archon-User': active.starterWebUser,
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      transcript.push({ method, headers, status: response.status, response: text });
      await writeJson(join(evidence, attachment), { transcript, cleaned });
      assert.equal(response.status, status, `POST /mcp ${method}: ${text}`);
      return parseRpc(text);
    };

    const discovered = z.object({
      supportedVersions: z.array(z.string()),
      capabilities: z.object({ extensions: z.record(z.string(), z.unknown()) }).passthrough(),
      _meta: z.object({
        'io.modelcontextprotocol/serverInfo': z.object({ name: z.literal('archon'), version: z.string() }),
      }).passthrough(),
    }).passthrough().parse((await call('server/discover', {}, {
      'MCP-Protocol-Version': PROTOCOL,
      'Mcp-Method': 'server/discover',
    }, 200)).result);
    assert.deepEqual(discovered.supportedVersions, [PROTOCOL]);
    assert.deepEqual(Object.keys(discovered.capabilities.extensions).sort(), [EVENTS, TASKS]);

    const listed = z.object({
      tools: z.array(z.object({ name: z.string() }).passthrough()),
    }).passthrough().parse((await call('tools/list', {}, {
      'MCP-Protocol-Version': PROTOCOL,
      'Mcp-Method': 'tools/list',
    }, 200)).result);
    assert.deepEqual(listed.tools.map(tool => tool.name), ['run_workflow', 'get_run', 'list_runs']);

    const runs = z.object({
      structuredContent: z.object({ runs: z.array(z.unknown()) }),
      isError: z.boolean().optional(),
    }).passthrough().parse((await call('tools/call', { name: 'list_runs', arguments: {} }, {
      'MCP-Protocol-Version': PROTOCOL,
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'list_runs',
    }, 200)).result);
    assert.notEqual(runs.isError, true);
    assert.ok(Array.isArray(runs.structuredContent.runs));

    const events = z.object({
      resultType: z.literal('complete'),
      events: z.array(z.object({ name: z.string() }).passthrough()),
    }).passthrough().parse((await call('events/list', {}, {
      'MCP-Protocol-Version': PROTOCOL,
      'Mcp-Method': 'events/list',
    }, 200)).result);
    assert.ok(events.events.some(event => event.name === 'workflow_run.status_changed'));

    const rejected = await call('server/discover', {}, { 'Mcp-Method': 'server/discover' }, 400);
    assert.equal(rejected.error?.code, -32020);

    const forbidden = await fetch(active.baseURL + '/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Origin: 'https://evil.example.com',
        'MCP-Protocol-Version': PROTOCOL,
        'Mcp-Method': 'server/discover',
      },
      body: rpcBody(1, 'server/discover', {}),
      signal: AbortSignal.timeout(20_000),
    });
    const forbiddenText = await forbidden.text();
    transcript.push({ method: 'server/discover', origin: 'https://evil.example.com', status: forbidden.status, response: forbiddenText });
    await writeJson(join(evidence, attachment), { transcript, cleaned });
    assert.equal(forbidden.status, 403, forbiddenText);
  } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  finally {
    try {
      if (runtime) {
        const home = runtime.home;
        await runtime.stop();
        assert.equal(await stat(home).then(() => true, () => false), false, 'Runtime scratch must be removed');
        transcript.push({ home, baseURL: runtime.baseURL, cleanup: 'stopped and removed' });
      }
      cleaned = true;
    } catch (error) { errors.push(`Cleanup failed: ${String(error)}`); }
    await writeJson(join(evidence, attachment), { transcript, cleaned, errors });
  }
  return {
    id, status: errors.length ? 'failed' : 'passed', errors,
    attachments: [{ name: `${id}.transcript`, path: attachment }],
  };
}
