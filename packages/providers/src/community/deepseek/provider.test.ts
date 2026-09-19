import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MessageChunk } from '../../types';
import type { DeepseekProcessInput } from './acp-client';
import { DEEPSEEK_CAPABILITIES } from './capabilities';
import { DeepseekProviderError } from './errors';
import { DeepseekProvider, type DeepseekTurnRunner } from './provider';

const tempDirs: string[] = [];
const API_KEY = 'sk-deepseek-provider-test-key';

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function collect(gen: AsyncGenerator<MessageChunk>): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

function successChunks(): MessageChunk[] {
  return [
    { type: 'assistant', content: 'hello' },
    { type: 'tool', toolName: 'read', toolCallId: 'call-1', toolInput: { path: 'a.ts' } },
    { type: 'result', sessionId: 'sess-out' },
  ];
}

function recordingRunner(
  calls: DeepseekProcessInput[],
  chunks: MessageChunk[] = successChunks()
): DeepseekTurnRunner {
  return async function* (input: DeepseekProcessInput): AsyncGenerator<MessageChunk> {
    calls.push(input);
    for (const chunk of chunks) {
      yield chunk;
    }
  };
}

function throwingRunner(calls: DeepseekProcessInput[], error: unknown): DeepseekTurnRunner {
  return async function* (input: DeepseekProcessInput): AsyncGenerator<MessageChunk> {
    calls.push(input);
    throw error;
  };
}

function queryEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { DEEPSEEK_API_KEY: API_KEY, ...extra };
}

async function writeMcpConfig(contents: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'archon-deepseek-provider-'));
  tempDirs.push(dir);
  const path = join(dir, 'mcp.json');
  await writeFile(path, JSON.stringify(contents));
  return path;
}

describe('DeepseekProvider', () => {
  test('getType is deepseek and getCapabilities returns the shared constant', () => {
    const provider = new DeepseekProvider();
    expect(provider.getType()).toBe('deepseek');
    expect(provider.getCapabilities()).toBe(DEEPSEEK_CAPABILITIES);
    expect(provider.getCapabilities()).toEqual(DEEPSEEK_CAPABILITIES);
  });

  test('pre-aborted signal yields one deepseek_aborted result without preflight', async () => {
    const calls: DeepseekProcessInput[] = [];
    let nodeCalled = false;
    let dshCalled = false;
    const abort = new AbortController();
    abort.abort();
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: (): string => {
        nodeCalled = true;
        return '/stub/node';
      },
      resolveDshEntrypoint: (): string => {
        dshCalled = true;
        return '/stub/dsh.js';
      },
    });

    const chunks = await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        abortSignal: abort.signal,
        assistantConfig: { maxTokens: 32 },
        env: queryEnv(),
        nodeConfig: { mcp: '/missing.json' },
      })
    );

    expect(chunks).toEqual([
      {
        type: 'result',
        isError: true,
        errorSubtype: 'deepseek_aborted',
        errors: ['DeepSeek turn aborted before start.'],
      },
    ]);
    expect(calls).toEqual([]);
    expect(nodeCalled).toBe(false);
    expect(dshCalled).toBe(false);
  });

  test('forwards interruptSignal alongside abortSignal into DeepseekProcessInput', async () => {
    const calls: DeepseekProcessInput[] = [];
    const abort = new AbortController();
    const interrupt = new AbortController();
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        abortSignal: abort.signal,
        interruptSignal: interrupt.signal,
        env: queryEnv(),
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.abortSignal).toBe(abort.signal);
    expect(calls[0]?.interruptSignal).toBe(interrupt.signal);
  });

  test('allows DSH-managed credentials without DEEPSEEK_API_KEY', async () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const calls: DeepseekProcessInput[] = [];
      let nodeCalled = false;
      let dshCalled = false;
      const provider = new DeepseekProvider({
        runTurn: recordingRunner(calls),
        resolveNodeBinary: (): string => {
          nodeCalled = true;
          return '/stub/node';
        },
        resolveDshEntrypoint: (): string => {
          dshCalled = true;
          return '/stub/dsh.js';
        },
      });

      const chunks = await collect(provider.sendQuery('hi', '/repo'));
      expect(chunks).toEqual(successChunks());
      expect(calls).toHaveLength(1);
      expect(Object.hasOwn(calls[0]?.env ?? {}, 'DEEPSEEK_API_KEY')).toBe(false);
      expect(nodeCalled).toBe(true);
      expect(dshCalled).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = previous;
      }
    }
  });

  test('options.model beats assistant config model', async () => {
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        model: 'option-model',
        assistantConfig: { model: 'config-model' },
        env: queryEnv(),
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe('option-model');
    expect(calls[0]?.providerRoute).toBe('deepseek-official');
    expect(calls[0]?.profile).toBe('acp');
  });

  test('splits a provider-qualified model reference into the DSH route and model', async () => {
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        model: 'qwen-token-plan/deepseek-v4-flash',
        env: queryEnv(),
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.providerRoute).toBe('qwen-token-plan');
    expect(calls[0]?.model).toBe('deepseek-v4-flash');
  });

  test('assistant providerRoute pairs with a request-level model', async () => {
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        model: 'account-model',
        assistantConfig: { providerRoute: 'dashscope-route' },
        env: queryEnv(),
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe('account-model');
    expect(calls[0]?.providerRoute).toBe('dashscope-route');
  });

  test('custom providerRoute without an effective model fails before the runner', async () => {
    const calls: DeepseekProcessInput[] = [];
    let nodeCalled = false;
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: (): string => {
        nodeCalled = true;
        return '/stub/node';
      },
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        assistantConfig: { providerRoute: 'dashscope-route' },
        env: queryEnv(),
      })
    );

    expect(calls).toEqual([]);
    expect(nodeCalled).toBe(false);
    expect(chunks).toEqual([
      {
        type: 'result',
        isError: true,
        errorSubtype: 'deepseek_unsupported_config',
        errors: [
          'assistants.deepseek.providerRoute requires a model from assistants.deepseek.model or the request model because DSH model routing is sent as [providerRoute, model].',
        ],
      },
    ]);
  });

  test('nodeConfig.effort beats assistant config effort and is translated', async () => {
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        assistantConfig: { model: 'm', effort: 'high' },
        nodeConfig: { effort: 'medium' },
        env: queryEnv(),
      })
    );

    expect(calls[0]?.effort).toBe('low');
  });

  test('child environment proves request credential and config base-URL precedence', async () => {
    const previousKey = process.env.DEEPSEEK_API_KEY;
    const previousUrl = process.env.DEEPSEEK_BASE_URL;
    process.env.DEEPSEEK_API_KEY = 'ambient-key';
    process.env.DEEPSEEK_BASE_URL = 'https://ambient.example/v1';
    try {
      const calls: DeepseekProcessInput[] = [];
      const provider = new DeepseekProvider({
        runTurn: recordingRunner(calls),
        resolveNodeBinary: () => '/stub/node',
        resolveDshEntrypoint: () => '/stub/dsh.js',
      });

      await collect(
        provider.sendQuery('hi', '/repo', undefined, {
          assistantConfig: { baseUrl: 'https://config.example/v1' },
          env: {
            DEEPSEEK_API_KEY: 'request-key',
            DEEPSEEK_BASE_URL: 'https://request.example/v1',
          },
        })
      );

      expect(calls[0]?.env.DEEPSEEK_API_KEY).toBe('request-key');
      expect(calls[0]?.env.DEEPSEEK_BASE_URL).toBe('https://config.example/v1');
      expect(calls[0]?.env.DSH_PERMISSION_MODE).toBe('workspace-write');
      expect(calls[0]?.env).not.toHaveProperty('DSH_PROVIDER_ROUTE');
    } finally {
      if (previousKey === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = previousKey;
      }
      if (previousUrl === undefined) {
        delete process.env.DEEPSEEK_BASE_URL;
      } else {
        process.env.DEEPSEEK_BASE_URL = previousUrl;
      }
    }
  });

  test('MCP loading receives merged process and request env, and duplicate missing vars yield one warning', async () => {
    const token = 'request-only-mcp-token';
    const mcpPath = await writeMcpConfig({
      echo: {
        type: 'http',
        url: 'https://mcp.example/http',
        headers: {
          Authorization: 'Bearer $ARCHON_DEEPSEEK_MCP_TOKEN',
          PathProbe: '$PATH',
          MissingA: '$ARCHON_DEEPSEEK_MISSING_MCP_VAR',
          MissingB: '$ARCHON_DEEPSEEK_MISSING_MCP_VAR',
        },
      },
    });
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        env: { ...queryEnv(), ARCHON_DEEPSEEK_MCP_TOKEN: token },
        nodeConfig: { mcp: mcpPath },
      })
    );

    const warnings = chunks.filter(chunk => chunk.type === 'system');
    expect(warnings).toHaveLength(1);
    const warningText = warnings[0]?.type === 'system' ? warnings[0].content : '';
    expect(warningText).toContain('ARCHON_DEEPSEEK_MISSING_MCP_VAR');
    expect(warningText.split('ARCHON_DEEPSEEK_MISSING_MCP_VAR')).toHaveLength(2);

    expect(calls).toHaveLength(1);
    const server = calls[0]?.mcpServers[0];
    expect(server).toMatchObject({
      type: 'http',
      name: 'echo',
      url: 'https://mcp.example/http',
    });
    if (server !== undefined && 'headers' in server) {
      const headers = Object.fromEntries(server.headers.map(header => [header.name, header.value]));
      expect(headers.Authorization).toBe(`Bearer ${token}`);
      expect(headers.PathProbe).toBe(process.env.PATH ?? '');
    }
  });

  test('MCP translator errors yield deepseek_mcp_config_error and do not run a turn', async () => {
    const mcpPath = await writeMcpConfig({
      events: { type: 'sse', url: 'https://mcp.example/sse' },
    });
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        env: queryEnv(),
        nodeConfig: { mcp: mcpPath },
      })
    );

    expect(calls).toEqual([]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'deepseek_mcp_config_error',
    });
    const message = chunks[0]?.type === 'result' ? chunks[0].errors?.[0] : undefined;
    expect(message).toContain('stdio');
    expect(message).toContain('Streamable HTTP');
  });

  test('MCP load errors yield deepseek_mcp_config_error and do not run a turn', async () => {
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        env: queryEnv(),
        nodeConfig: { mcp: '/definitely/missing/deepseek-mcp.json' },
      })
    );

    expect(calls).toEqual([]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'deepseek_mcp_config_error',
    });
    expect(chunks[0]?.type === 'result' ? chunks[0].errors?.[0] : undefined).toContain(
      'MCP config file not found'
    );
  });

  test('fresh success does not add a resumed property', async () => {
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(provider.sendQuery('hi', '/repo', undefined, { env: queryEnv() }));
    const result = chunks.find(chunk => chunk.type === 'result');
    expect(result).toEqual({ type: 'result', sessionId: 'sess-out' });
    expect(result).not.toHaveProperty('resumed');
    expect(calls[0]?.resumeSessionId).toBeUndefined();
  });

  test('resume success stamps resumed: true through withResumedOutcome', async () => {
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: recordingRunner(calls),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(
      provider.sendQuery('hi', '/repo', 'sess-prior', { env: queryEnv() })
    );
    const result = chunks.find(chunk => chunk.type === 'result');
    expect(result).toMatchObject({ type: 'result', sessionId: 'sess-out', resumed: true });
    expect(calls[0]?.resumeSessionId).toBe('sess-prior');
  });

  test('resume failure yields exactly one deepseek_resume_failed result and never retries', async () => {
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: throwingRunner(
        calls,
        new DeepseekProviderError('deepseek_resume_failed', 'ACP session/resume failed')
      ),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(
      provider.sendQuery('hi', '/repo', 'sess-prior', { env: queryEnv() })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.resumeSessionId).toBe('sess-prior');
    expect(chunks).toEqual([
      {
        type: 'result',
        isError: true,
        errorSubtype: 'deepseek_resume_failed',
        errors: ['ACP session/resume failed'],
      },
    ]);
    expect(chunks[0]).not.toHaveProperty('resumed');
  });

  test('unknown runner failure yields one redacted deepseek_acp_error result', async () => {
    const calls: DeepseekProcessInput[] = [];
    const requestSecret = 'request-token-secret';
    const provider = new DeepseekProvider({
      runTurn: throwingRunner(calls, new Error(`child died with ${API_KEY} then ${requestSecret}`)),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        env: queryEnv({ ARCHON_DEEPSEEK_EXTRA_TOKEN: requestSecret }),
      })
    );

    expect(chunks).toEqual([
      {
        type: 'result',
        isError: true,
        errorSubtype: 'deepseek_acp_error',
        errors: ['child died with [REDACTED] then [REDACTED]'],
      },
    ]);
    expect(JSON.stringify(chunks)).not.toContain(API_KEY);
    expect(JSON.stringify(chunks)).not.toContain(requestSecret);
  });

  test('runner errors redact MCP header secrets', async () => {
    const headerSecret = 'Bearer static-mcp-token';
    const mcpPath = await writeMcpConfig({
      api: {
        type: 'http',
        url: 'https://mcp.example/http',
        headers: { Authorization: headerSecret },
      },
    });
    const calls: DeepseekProcessInput[] = [];
    const provider = new DeepseekProvider({
      runTurn: throwingRunner(calls, new Error(`mcp failed with ${headerSecret}`)),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(
      provider.sendQuery('hi', '/repo', undefined, {
        env: queryEnv(),
        nodeConfig: { mcp: mcpPath },
      })
    );

    expect(calls).toHaveLength(1);
    // The runner is what accumulates and redacts child stderr, so it must be
    // handed the combined set: the env key plus MCP header values, which never
    // enter the child environment.
    expect(calls[0]?.secretValues).toContain(headerSecret);
    expect(calls[0]?.secretValues).toContain(API_KEY);
    expect(chunks).toEqual([
      {
        type: 'result',
        isError: true,
        errorSubtype: 'deepseek_acp_error',
        errors: ['mcp failed with [REDACTED]'],
      },
    ]);
    expect(JSON.stringify(chunks)).not.toContain(headerSecret);
  });

  test('assistant and tool chunks remain in original order', async () => {
    const provider = new DeepseekProvider({
      runTurn: recordingRunner([]),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(provider.sendQuery('hi', '/repo', undefined, { env: queryEnv() }));
    expect(chunks.map(chunk => chunk.type)).toEqual(['assistant', 'tool', 'result']);
    expect(chunks[0]).toEqual({ type: 'assistant', content: 'hello' });
    expect(chunks[1]).toEqual({
      type: 'tool',
      toolName: 'read',
      toolCallId: 'call-1',
      toolInput: { path: 'a.ts' },
    });
  });

  test('result chunks never gain tokens, usageBreakdown, or synthesized cost', async () => {
    const provider = new DeepseekProvider({
      runTurn: recordingRunner([]),
      resolveNodeBinary: () => '/stub/node',
      resolveDshEntrypoint: () => '/stub/dsh.js',
    });

    const chunks = await collect(
      provider.sendQuery('hi', '/repo', 'sess-prior', {
        env: queryEnv(),
        outputFormat: { type: 'json_schema', schema: { type: 'object' } },
      })
    );

    for (const chunk of chunks) {
      expect(chunk).not.toHaveProperty('tokens');
      expect(chunk).not.toHaveProperty('usageBreakdown');
      expect(chunk).not.toHaveProperty('cost');
    }
  });
});
