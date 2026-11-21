/**
 * CursorProvider end-to-end contract test with a mocked @cursor/sdk.
 *
 * Exercises the complete Archon adapter flow: provider configuration, SDK
 * agent creation, streaming text/thinking/tool events, native tool execution,
 * usage normalization, structured output parsing, and terminal session data.
 * This file runs in its own Bun process because mock.module() is process-global.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentOptions,
  Run,
  RunResult,
  SDKAgent,
  SDKCustomTool,
  SDKMessage,
} from '@cursor/sdk';

import { createMockLogger } from '../test/mocks/logger';

const mockLogger = createMockLogger();
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

let createOptions: AgentOptions | undefined;
let resumeOptions: Partial<AgentOptions> | undefined;
let resumeId: string | undefined;
let sentPrompt: string | undefined;
let closed = false;
let streamMessages: SDKMessage[] = [];
let runResult: RunResult;

const fakeRun = {
  id: 'run-cursor-1',
  agentId: 'cursor-agent-1',
  status: 'finished',
  supports: () => true,
  unsupportedReason: () => undefined,
  async *stream(): AsyncGenerator<SDKMessage> {
    yield* streamMessages;
  },
  wait: async () => runResult,
  cancel: mock(async () => undefined),
  conversation: mock(async () => []),
  onDidChangeStatus: mock(() => () => undefined),
} as unknown as Run;

const fakeAgent = {
  agentId: 'cursor-agent-1',
  model: { id: 'composer-2.5' },
  send: mock(async (prompt: string) => {
    sentPrompt = prompt;
    return fakeRun;
  }),
  close: mock(() => {
    closed = true;
  }),
} as unknown as SDKAgent;

const createAgent = mock(async (options: AgentOptions) => {
  createOptions = options;
  return fakeAgent;
});
const resumeAgent = mock(async (agentId: string, options?: Partial<AgentOptions>) => {
  resumeId = agentId;
  resumeOptions = options;
  return fakeAgent;
});

mock.module('@cursor/sdk', () => ({
  Agent: {
    create: createAgent,
    resume: resumeAgent,
  },
}));

const { CursorProvider } = await import('./provider');

const originalCursorKey = process.env.CURSOR_API_KEY;

async function collect(
  provider: CursorProvider,
  options: Parameters<CursorProvider['sendQuery']>[3]
) {
  const chunks = [];
  for await (const chunk of provider.sendQuery('Return the result', '/repo', undefined, options)) {
    chunks.push(chunk);
  }
  return chunks;
}

beforeEach(() => {
  process.env.CURSOR_API_KEY = 'process-cursor-key';
  createOptions = undefined;
  resumeOptions = undefined;
  resumeId = undefined;
  sentPrompt = undefined;
  closed = false;
  createAgent.mockReset();
  createAgent.mockImplementation(async (options: AgentOptions) => {
    createOptions = options;
    return fakeAgent;
  });
  resumeAgent.mockReset();
  resumeAgent.mockImplementation(async (agentId: string, options?: Partial<AgentOptions>) => {
    resumeId = agentId;
    resumeOptions = options;
    return fakeAgent;
  });
  (fakeAgent.send as ReturnType<typeof mock>).mockReset();
  (fakeAgent.send as ReturnType<typeof mock>).mockImplementation(async (prompt: string) => {
    sentPrompt = prompt;
    return fakeRun;
  });
  (fakeAgent.close as ReturnType<typeof mock>).mockReset();
  (fakeAgent.close as ReturnType<typeof mock>).mockImplementation(() => {
    closed = true;
  });
  (fakeRun.cancel as ReturnType<typeof mock>).mockReset();
  (fakeRun.cancel as ReturnType<typeof mock>).mockImplementation(async () => undefined);
  streamMessages = [
    {
      type: 'system',
      subtype: 'init',
      agent_id: 'cursor-agent-1',
      run_id: 'run-cursor-1',
    },
    {
      type: 'thinking',
      agent_id: 'cursor-agent-1',
      run_id: 'run-cursor-1',
      text: 'Checking the repository',
    },
    {
      type: 'tool_call',
      agent_id: 'cursor-agent-1',
      run_id: 'run-cursor-1',
      call_id: 'tool-1',
      name: 'read',
      status: 'running',
      args: { path: 'README.md' },
    },
    {
      type: 'tool_call',
      agent_id: 'cursor-agent-1',
      run_id: 'run-cursor-1',
      call_id: 'tool-1',
      name: 'read',
      status: 'completed',
      result: { content: 'ok' },
    },
    {
      type: 'assistant',
      agent_id: 'cursor-agent-1',
      run_id: 'run-cursor-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '{"answer":"done"}' }],
      },
    },
    {
      type: 'usage',
      agent_id: 'cursor-agent-1',
      run_id: 'run-cursor-1',
      usage: {
        inputTokens: 12,
        outputTokens: 7,
        cacheReadTokens: 3,
        cacheWriteTokens: 0,
        totalTokens: 19,
        reasoningTokens: 2,
      },
    },
  ];
  runResult = {
    id: 'run-cursor-1',
    status: 'finished',
    result: '{"answer":"done"}',
    model: { id: 'composer-2.5' },
  };
});

afterEach(() => {
  if (originalCursorKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = originalCursorKey;
});

describe('CursorProvider', () => {
  test('runs a complete Cursor turn through the Archon provider contract', async () => {
    const nativeHandler = mock(async () => 'managed');
    const provider = new CursorProvider();
    const chunks = await collect(provider, {
      model: 'composer-2.5',
      env: { CURSOR_API_KEY: 'cursor-secret' },
      systemPrompt: 'Follow repository rules.',
      nodeConfig: {
        output_format: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
        allowed_tools: ['read', 'mcp'],
      },
      nativeTools: [
        {
          name: 'manage_run',
          description: 'Manage an Archon workflow run',
          inputSchema: {
            type: 'object',
            properties: { runId: { type: 'string' } },
            required: ['runId'],
          },
          handler: nativeHandler,
        },
      ],
    });

    expect(createOptions?.model).toEqual({ id: 'composer-2.5' });
    expect(createOptions?.apiKey).toBe('cursor-secret');
    expect(createOptions?.local?.cwd).toBe('/repo');
    expect(createOptions?.tools).toEqual(['read', 'mcp']);
    expect(sentPrompt).toContain('Follow repository rules.');
    expect(sentPrompt).toContain('Respond with ONLY a JSON object');

    const customTool = createOptions?.local?.customTools?.manage_run as SDKCustomTool;
    await customTool.execute(
      { runId: 'workflow-1' },
      { toolCallId: 'native-1', sessionId: 'cursor-session-1' }
    );
    expect(nativeHandler).toHaveBeenCalledWith(
      { runId: 'workflow-1' },
      { toolUseId: 'native-1', sessionId: 'cursor-session-1' }
    );

    expect(chunks).toContainEqual({
      type: 'thinking',
      content: 'Checking the repository',
      textMode: 'complete',
    });
    expect(chunks).toContainEqual({
      type: 'tool',
      toolName: 'read',
      toolCallId: 'tool-1',
      toolInput: { path: 'README.md' },
    });
    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'read',
      toolCallId: 'tool-1',
      toolOutput: '{"content":"ok"}',
      toolOutcome: 'success',
    });
    expect(chunks).toContainEqual({
      type: 'assistant',
      content: '{"answer":"done"}',
      textMode: 'complete',
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'cursor-agent-1',
      tokens: { input: 12, output: 7 },
      structuredOutput: { answer: 'done' },
      resolvedModel: { id: 'composer-2.5' },
      stopReason: 'finished',
    });
    expect(closed).toBe(true);
  });

  test('resumes a Cursor agent and reports the resume outcome', async () => {
    const provider = new CursorProvider();
    const chunks = [];
    for await (const chunk of provider.sendQuery('Continue', '/repo', 'cursor-existing', {
      model: 'composer-2.5',
    })) {
      chunks.push(chunk);
    }

    expect(resumeId).toBe('cursor-existing');
    expect(resumeOptions?.local?.cwd).toBe('/repo');
    expect(createAgent).not.toHaveBeenCalled();
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'cursor-agent-1',
      resumed: true,
    });
  });

  test('cancels the active SDK run on operator Stop and preserves the session id', async () => {
    const controller = new AbortController();
    controller.abort();
    runResult = {
      id: 'run-cursor-1',
      status: 'cancelled',
      model: { id: 'composer-2.5' },
    };

    const provider = new CursorProvider();
    const chunks = await collect(provider, {
      model: 'composer-2.5',
      interruptSignal: controller.signal,
    });

    expect(fakeRun.cancel).toHaveBeenCalledTimes(1);
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'cursor-agent-1',
      terminalReason: 'stream_aborted',
      stopReason: 'cancelled',
    });
    expect(chunks.at(-1)).not.toHaveProperty('isError');
  });

  test('request key overrides the process key', async () => {
    const provider = new CursorProvider();
    await collect(provider, {
      model: 'composer-2.5',
      env: { CURSOR_API_KEY: '  request-cursor-key  ' },
    });

    expect(createOptions?.apiKey).toBe('request-cursor-key');
    expect(createAgent).toHaveBeenCalledTimes(1);
  });

  test('missing or blank key fails before Agent.create', async () => {
    const provider = new CursorProvider();
    delete process.env.CURSOR_API_KEY;

    await expect(collect(provider, { model: 'composer-2.5' })).rejects.toThrow(/CURSOR_API_KEY/);
    await expect(
      collect(provider, { model: 'composer-2.5', env: { CURSOR_API_KEY: '   ' } })
    ).rejects.toThrow(/CURSOR_API_KEY/);
    await expect(
      provider.sendQuery('Continue', '/repo', 'cursor-existing', { model: 'composer-2.5' }).next()
    ).rejects.toThrow(/CURSOR_API_KEY/);

    expect(createAgent).not.toHaveBeenCalled();
    expect(resumeAgent).not.toHaveBeenCalled();
  });

  test('a blank request key does not fall through to the process key', async () => {
    const provider = new CursorProvider();
    await expect(
      collect(provider, { model: 'composer-2.5', env: { CURSOR_API_KEY: ' ' } })
    ).rejects.toThrow(/CURSOR_API_KEY/);
    expect(createAgent).not.toHaveBeenCalled();
  });

  test('enables the local sandbox and maps denied tools', async () => {
    const provider = new CursorProvider();
    await collect(provider, {
      model: 'composer-2.5',
      nodeConfig: { denied_tools: ['shell', 'write'] },
    });

    expect(createOptions?.local?.sandboxOptions).toEqual({ enabled: true });
    expect(createOptions?.disallowedTools).toEqual(['shell', 'write']);
    expect(createOptions?.apiKey).toBe('process-cursor-key');
  });

  test('maps stdio and HTTP/SSE MCP servers and expands env and headers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archon-cursor-mcp-'));
    const mcpPath = join(dir, 'mcp.json');
    writeFileSync(
      mcpPath,
      JSON.stringify({
        local: {
          command: 'npx',
          args: ['-y', 'server'],
          env: { TOKEN: '$MCP_TOKEN' },
          cwd: '/work',
        },
        remote: {
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer ${MCP_HTTP_TOKEN}' },
        },
        events: {
          type: 'sse',
          url: 'https://example.com/sse',
        },
      })
    );

    try {
      const provider = new CursorProvider();
      await collect(provider, {
        model: 'composer-2.5',
        env: { MCP_TOKEN: 'stdio-secret', MCP_HTTP_TOKEN: 'http-secret' },
        nodeConfig: { mcp: mcpPath },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(createOptions?.mcpServers).toEqual({
      local: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'server'],
        env: { TOKEN: 'stdio-secret' },
        cwd: '/work',
      },
      remote: {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer http-secret' },
      },
      events: {
        type: 'sse',
        url: 'https://example.com/sse',
      },
    });
  });

  test('resume rejection falls back to create and reports resumed false', async () => {
    resumeAgent.mockImplementationOnce(async (agentId: string, options?: Partial<AgentOptions>) => {
      resumeId = agentId;
      resumeOptions = options;
      throw new Error('session gone');
    });
    const provider = new CursorProvider();
    const chunks = [];
    for await (const chunk of provider.sendQuery('Continue', '/repo', 'cursor-missing', {
      model: 'composer-2.5',
    })) {
      chunks.push(chunk);
    }

    expect(resumeId).toBe('cursor-missing');
    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'cursor-agent-1',
      resumed: false,
    });
    expect(closed).toBe(true);
  });

  test('an already-aborted node signal throws before creating an agent', async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new CursorProvider();
    await expect(
      collect(provider, { model: 'composer-2.5', abortSignal: controller.signal })
    ).rejects.toThrow('Query aborted');
    expect(createAgent).not.toHaveBeenCalled();
    expect(fakeAgent.send).not.toHaveBeenCalled();
  });

  test('a node cancel mid-stream throws and closes the agent instead of yielding a result', async () => {
    const interrupt = new AbortController();
    const abort = new AbortController();
    runResult = {
      id: 'run-cursor-1',
      status: 'cancelled',
      model: { id: 'composer-2.5' },
    };

    const provider = new CursorProvider();
    const chunks: unknown[] = [];
    let error: unknown;
    try {
      for await (const chunk of provider.sendQuery('Return the result', '/repo', undefined, {
        model: 'composer-2.5',
        interruptSignal: interrupt.signal,
        abortSignal: abort.signal,
      })) {
        chunks.push(chunk);
        if (chunks.length === 1) {
          interrupt.abort();
          abort.abort();
        }
      }
    } catch (err) {
      error = err;
    }

    expect((error as Error | undefined)?.message).toBe('Query aborted');
    expect(fakeRun.cancel).toHaveBeenCalledTimes(1);
    expect(chunks).toHaveLength(1);
    expect(chunks.some(c => (c as { type: string }).type === 'result')).toBe(false);
    expect(closed).toBe(true);
  });

  test('an operator Stop that races a natural finish keeps the completed result', async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new CursorProvider();
    const chunks = await collect(provider, {
      model: 'composer-2.5',
      interruptSignal: controller.signal,
    });

    expect(chunks.at(-1)).toMatchObject({ type: 'result', stopReason: 'finished' });
    expect(chunks.at(-1)).not.toHaveProperty('terminalReason');
    expect(chunks.at(-1)).not.toHaveProperty('isError');
  });

  test('an operator Stop that races an SDK error still reports the error', async () => {
    const controller = new AbortController();
    controller.abort();
    runResult = {
      id: 'run-cursor-1',
      status: 'error',
      model: { id: 'composer-2.5' },
    };

    const provider = new CursorProvider();
    const chunks = await collect(provider, {
      model: 'composer-2.5',
      interruptSignal: controller.signal,
    });

    expect(chunks.at(-1)).toMatchObject({ type: 'result', isError: true, stopReason: 'error' });
    expect(chunks.at(-1)).not.toHaveProperty('terminalReason');
  });

  test('does not parse structured output when no schema is requested', async () => {
    const provider = new CursorProvider();
    const chunks = await collect(provider, { model: 'composer-2.5' });

    expect(chunks.at(-1)).toMatchObject({ type: 'result', stopReason: 'finished' });
    expect(chunks.at(-1)).not.toHaveProperty('structuredOutput');
  });

  test('reports usage as one aggregate turn attributed to the reported model', async () => {
    const provider = new CursorProvider();
    const chunks = await collect(provider, { model: 'composer-2.5' });

    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      usageBreakdown: [
        {
          provider: 'cursor',
          model: 'composer-2.5',
          modelSource: 'reported',
          inputTokens: 12,
          outputTokens: 7,
          cacheReadTokens: 3,
          cacheWriteTokens: 0,
          reasoningTokens: 2,
        },
      ],
    });
    const result = chunks.at(-1) as { usageBreakdown: Record<string, unknown>[] };
    expect(result.usageBreakdown[0]).not.toHaveProperty('requests');
  });

  test('attributes usage to the trimmed requested model when the SDK reports none', async () => {
    runResult = { id: 'run-cursor-1', status: 'finished', result: 'done' };

    const provider = new CursorProvider();
    const chunks = await collect(provider, { model: ' composer-2.5 ' });

    expect(createOptions?.model).toEqual({ id: 'composer-2.5' });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      usageBreakdown: [{ provider: 'cursor', model: 'composer-2.5', modelSource: 'requested' }],
    });
    expect(chunks.at(-1)).not.toHaveProperty('resolvedModel');
  });

  test('closes the agent when the run fails', async () => {
    (fakeAgent.send as ReturnType<typeof mock>).mockRejectedValueOnce(new Error('send failed'));
    const provider = new CursorProvider();

    await expect(collect(provider, { model: 'composer-2.5' })).rejects.toThrow('send failed');
    expect(closed).toBe(true);
    expect(fakeAgent.close).toHaveBeenCalledTimes(1);
  });
});
