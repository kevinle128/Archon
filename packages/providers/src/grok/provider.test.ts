import { describe, expect, test } from 'bun:test';

import type { GrokAcpProcessInput } from './acp-client';
import {
  buildGrokArgs,
  GrokProvider,
  selectGrokTransport,
  type GrokAcpTurnRunner,
  type GrokProcess,
  type GrokSpawner,
} from './provider';
import { parseGrokConfig } from './config';
import type { MessageChunk, SendQueryOptions } from '../types';
import { STREAM_ABORTED_TERMINAL_REASON } from '../types';

/**
 * Forces `selectGrokTransport()` to pick the legacy `--single` transport —
 * `output_format` has no verified ACP equivalent (see `selectGrokTransport`'s
 * own doc comment). Every `GrokProvider` behavioral test below that exercises
 * the `--single`/streaming-json plumbing (NDJSON reassembly, exit codes,
 * stderr/exit races, process kill on Cancel) merges this in so it keeps
 * hitting that code path now that ACP is the default.
 */
const FORCE_SINGLE_TRANSPORT: SendQueryOptions = {
  outputFormat: { type: 'json_schema', schema: { type: 'object' } },
};

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller): void {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function processFor(stdout: string[], stderr = '', exitCode = 0): GrokProcess {
  return {
    stdout: stream(stdout),
    stderr: stream([stderr]),
    exited: Promise.resolve(exitCode),
    kill: (): void => {},
  };
}

function usageTerminalLines(sessionId = 'session-usage'): string[] {
  return [
    '{"type":"text","data":"hello"}\n',
    JSON.stringify({
      type: 'end',
      stopReason: 'end_turn',
      sessionId,
      requestId: 'request-1',
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      total_cost_usd: 0.25,
      modelUsage: { 'grok-build': { modelCalls: 2 } },
    }) + '\n',
  ];
}

function processWithStderrReject(stdout: string[]): GrokProcess {
  return {
    stdout: stream(stdout),
    stderr: new ReadableStream({
      start(controller): void {
        controller.error(new Error('stderr read failed'));
      },
    }),
    exited: Promise.resolve(0),
    kill: (): void => {},
  };
}

function processWithExitReject(stdout: string[]): GrokProcess {
  const exited = Promise.reject(new Error('exit wait failed'));
  void exited.catch(() => undefined);
  return {
    stdout: stream(stdout),
    stderr: stream([]),
    exited,
    kill: (): void => {},
  };
}

function processWithStdoutFailAfter(stdoutText: string): GrokProcess {
  const encoder = new TextEncoder();
  const payload = encoder.encode(stdoutText.endsWith('\n') ? stdoutText : `${stdoutText}\n`);
  let delivered = false;
  return {
    stdout: new ReadableStream({
      pull(controller): void {
        if (!delivered) {
          delivered = true;
          controller.enqueue(payload);
          return;
        }
        controller.error(new Error('stdout read failed'));
      },
    }),
    stderr: stream([]),
    exited: Promise.resolve(0),
    kill: (): void => {},
  };
}

async function collect(
  provider: GrokProvider,
  options: Parameters<GrokProvider['sendQuery']>
): Promise<unknown[]> {
  const chunks: unknown[] = [];
  for await (const chunk of provider.sendQuery(...options)) chunks.push(chunk);
  return chunks;
}

describe('buildGrokArgs', () => {
  test('maps the supported headless CLI surface', () => {
    expect(
      buildGrokArgs({
        prompt: 'do it',
        cwd: '/repo',
        config: { model: 'default', permissionMode: 'acceptEdits' },
        resumeSessionId: 'old-session',
        requestOptions: {
          model: 'grok-build',
          systemPrompt: { type: 'preset', preset: 'claude_code', append: 'extra rules' },
          forkSession: true,
          outputFormat: { type: 'json_schema', schema: { type: 'object' } },
          nodeConfig: {
            effort: 'high',
            allowed_tools: ['read_file', 'grep'],
            denied_tools: ['run_terminal_cmd'],
            agents: {
              reviewer: { description: 'Review', prompt: 'Review carefully' },
            },
          },
        },
      }).args
    ).toEqual([
      '--single',
      'do it',
      '--verbatim',
      '--cwd',
      '/repo',
      '--output-format',
      'streaming-json',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'grok-build',
      '--reasoning-effort',
      'high',
      '--rules',
      'extra rules',
      '--tools',
      'read_file,grep',
      '--disallowed-tools',
      'run_terminal_cmd',
      '--agents',
      '{"reviewer":{"description":"Review","prompt":"Review carefully"}}',
      '--json-schema',
      '{"type":"object"}',
      '--resume',
      'old-session',
      '--fork-session',
    ]);
  });

  test('defaults to bypass permissions and rejects impossible non-persistent resume', () => {
    expect(buildGrokArgs({ prompt: 'hi', cwd: '/repo', config: {} }).args).toContain(
      'bypassPermissions'
    );
    expect(() =>
      buildGrokArgs({
        prompt: 'hi',
        cwd: '/repo',
        config: {},
        requestOptions: { nodeConfig: { allowed_tools: [] } },
      })
    ).toThrow('cannot be enforced');
    expect(() =>
      buildGrokArgs({
        prompt: 'hi',
        cwd: '/repo',
        config: {},
        resumeSessionId: 'session',
        requestOptions: { persistSession: false },
      })
    ).toThrow('persistSession is false');
  });
});

describe('selectGrokTransport', () => {
  test('defaults to ACP when no node config needs an unverified flag', () => {
    expect(selectGrokTransport({ config: {} })).toEqual({ kind: 'acp' });
    expect(selectGrokTransport({ config: { permissionMode: 'bypassPermissions' } })).toEqual({
      kind: 'acp',
    });
  });

  test('falls back for structured output (--json-schema)', () => {
    const selection = selectGrokTransport({
      config: {},
      requestOptions: { outputFormat: { type: 'json_schema', schema: { type: 'object' } } },
    });
    expect(selection.kind).toBe('single');
  });

  test('falls back for inline sub-agent definitions (--agents)', () => {
    const selection = selectGrokTransport({
      config: {},
      requestOptions: {
        nodeConfig: { agents: { reviewer: { description: 'Review', prompt: 'Review carefully' } } },
      },
    });
    expect(selection.kind).toBe('single');
  });

  test('an empty agents map does not force a fallback', () => {
    expect(
      selectGrokTransport({ config: {}, requestOptions: { nodeConfig: { agents: {} } } })
    ).toEqual({ kind: 'acp' });
  });

  test('falls back for allowed_tools, including an empty array', () => {
    expect(
      selectGrokTransport({
        config: {},
        requestOptions: { nodeConfig: { allowed_tools: ['read_file'] } },
      }).kind
    ).toBe('single');
    expect(
      selectGrokTransport({ config: {}, requestOptions: { nodeConfig: { allowed_tools: [] } } })
        .kind
    ).toBe('single');
  });

  test('falls back for a non-empty denied_tools but not an empty one', () => {
    expect(
      selectGrokTransport({
        config: {},
        requestOptions: { nodeConfig: { denied_tools: ['run_terminal_cmd'] } },
      }).kind
    ).toBe('single');
    expect(
      selectGrokTransport({ config: {}, requestOptions: { nodeConfig: { denied_tools: [] } } })
    ).toEqual({ kind: 'acp' });
  });

  test('falls back for a system prompt override, from either field', () => {
    expect(
      selectGrokTransport({ config: {}, requestOptions: { systemPrompt: 'be terse' } }).kind
    ).toBe('single');
    expect(
      selectGrokTransport({
        config: {},
        requestOptions: { nodeConfig: { systemPrompt: 'be terse' } },
      }).kind
    ).toBe('single');
  });

  test('falls back for forkSession', () => {
    expect(selectGrokTransport({ config: {}, requestOptions: { forkSession: true } }).kind).toBe(
      'single'
    );
  });

  test('falls back for any permission mode other than bypassPermissions', () => {
    expect(selectGrokTransport({ config: { permissionMode: 'plan' } }).kind).toBe('single');
    expect(selectGrokTransport({ config: { permissionMode: 'acceptEdits' } }).kind).toBe('single');
  });
});

describe('GrokProvider --single fallback transport', () => {
  test('streams fragmented NDJSON, injects env, and returns the concrete session', async () => {
    let spawnedCommand: string[] = [];
    let spawnedEnv: Record<string, string> = {};
    const spawn: GrokSpawner = (command, options) => {
      spawnedCommand = command;
      spawnedEnv = options.env;
      return processFor([
        '{"type":"text","data":"hel',
        'lo"}\n{"type":"end","stopReason":"end_turn","sessionId":"session-1","requestId":"request-1"}\n',
      ]);
    };
    const provider = new GrokProvider({ spawn, resolveBinary: async () => '/bin/grok' });

    const chunks = await collect(provider, [
      'hello',
      '/repo',
      undefined,
      { env: { XAI_API_KEY: 'managed' }, ...FORCE_SINGLE_TRANSPORT },
    ]);
    expect(chunks).toEqual([
      { type: 'turn_not_interruptible', reason: expect.stringContaining('--json-schema') },
      { type: 'system', content: expect.stringContaining('legacy --single transport') },
      {
        type: 'assistant',
        content: 'hello',
        textMode: 'delta',
        blockId: 'grok-single-assistant-1',
      },
      { type: 'result', sessionId: 'session-1', stopReason: 'end_turn' },
    ]);
    // ⚠️-prefixed so the dag-executor's generic system-chunk forwarding
    // actually delivers this to the operator (an unprefixed notice is
    // dropped at debug level — see dag.system_message_unhandled).
    expect((chunks[1] as { content: string }).content.startsWith('⚠️')).toBe(true);
    expect(spawnedCommand[0]).toBe('/bin/grok');
    expect(spawnedEnv.XAI_API_KEY).toBe('managed');
  });

  test('maps nonzero authentication exits and unsuccessful resumes', async () => {
    const provider = new GrokProvider({
      spawn: () => processFor([], 'not authenticated', 1),
      resolveBinary: async () => '/bin/grok',
    });
    const chunks = await collect(provider, [
      'hello',
      '/repo',
      'old-session',
      FORCE_SINGLE_TRANSPORT,
    ]);
    expect(chunks).toContainEqual({
      type: 'system',
      content: expect.stringContaining('grok login'),
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_exit_nonzero',
      resumed: false,
    });
  });

  test('preserves parsed usage once when stderr rejects after a terminal end event', async () => {
    const provider = new GrokProvider({
      spawn: () => processWithStderrReject(usageTerminalLines('usage-stderr')),
      resolveBinary: async () => '/bin/grok',
    });
    const chunks = await collect(provider, ['hello', '/repo', undefined, FORCE_SINGLE_TRANSPORT]);
    const results = chunks.filter(
      (chunk): chunk is Record<string, unknown> =>
        typeof chunk === 'object' && chunk !== null && 'type' in chunk && chunk.type === 'result'
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_transport_error',
      sessionId: 'usage-stderr',
      stopReason: 'end_turn',
      tokens: { input: 10, output: 5, total: 15, cost: 0.25 },
      cost: 0.25,
      usageBreakdown: [
        {
          provider: 'xai',
          model: 'grok-build',
          modelSource: 'reported',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.25,
          requests: 2,
        },
      ],
      errors: ['stderr read failed'],
    });
  });

  test('preserves parsed usage once when process.exited rejects after a terminal end event', async () => {
    const provider = new GrokProvider({
      spawn: () => processWithExitReject(usageTerminalLines('usage-exit')),
      resolveBinary: async () => '/bin/grok',
    });
    const chunks = await collect(provider, ['hello', '/repo', undefined, FORCE_SINGLE_TRANSPORT]);
    const results = chunks.filter(
      (chunk): chunk is Record<string, unknown> =>
        typeof chunk === 'object' && chunk !== null && 'type' in chunk && chunk.type === 'result'
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_transport_error',
      sessionId: 'usage-exit',
      usageBreakdown: [
        {
          provider: 'xai',
          model: 'grok-build',
          modelSource: 'reported',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.25,
          requests: 2,
        },
      ],
      errors: ['exit wait failed'],
    });
  });

  test('preserves parsed usage once when stdout fails after the terminal end event', async () => {
    const provider = new GrokProvider({
      spawn: () => processWithStdoutFailAfter(usageTerminalLines('usage-stdout').join('')),
      resolveBinary: async () => '/bin/grok',
    });
    const chunks = await collect(provider, ['hello', '/repo', undefined, FORCE_SINGLE_TRANSPORT]);
    const results = chunks.filter(
      (chunk): chunk is Record<string, unknown> =>
        typeof chunk === 'object' && chunk !== null && 'type' in chunk && chunk.type === 'result'
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_transport_error',
      sessionId: 'usage-stdout',
      usageBreakdown: [
        {
          provider: 'xai',
          model: 'grok-build',
          modelSource: 'reported',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.25,
          requests: 2,
        },
      ],
      errors: ['stdout read failed'],
    });
  });

  test('throws on early stderr rejection with no parsed usage', async () => {
    const provider = new GrokProvider({
      spawn: () => processWithStderrReject([]),
      resolveBinary: async () => '/bin/grok',
    });
    await expect(
      collect(provider, ['hello', '/repo', undefined, FORCE_SINGLE_TRANSPORT])
    ).rejects.toThrow('stderr read failed');
  });

  test('keeps nonzero exit subtype and message when usage was observed', async () => {
    const provider = new GrokProvider({
      spawn: () => processFor(usageTerminalLines('usage-nonzero'), 'not authenticated', 1),
      resolveBinary: async () => '/bin/grok',
    });
    const chunks = await collect(provider, [
      'hello',
      '/repo',
      'old-session',
      FORCE_SINGLE_TRANSPORT,
    ]);
    expect(chunks).toContainEqual({
      type: 'system',
      content: expect.stringContaining('grok login'),
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_exit_nonzero',
      sessionId: 'usage-nonzero',
      resumed: false,
      usageBreakdown: [
        {
          provider: 'xai',
          model: 'grok-build',
          modelSource: 'reported',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.25,
          requests: 2,
        },
      ],
    });
  });

  test('terminates a running process when aborted', async () => {
    const signals: (NodeJS.Signals | undefined)[] = [];
    let resolveExit: ((value: number) => void) | undefined;
    let closeStdout: (() => void) | undefined;
    let spawned = false;
    const exited = new Promise<number>(resolve => {
      resolveExit = resolve;
    });
    const spawn: GrokSpawner = () => {
      spawned = true;
      return {
        stdout: new ReadableStream({
          start(controller): void {
            closeStdout = (): void => controller.close();
          },
        }),
        stderr: stream([]),
        exited,
        kill: signal => {
          signals.push(signal);
          closeStdout?.();
          resolveExit?.(143);
        },
      };
    };
    const controller = new AbortController();
    const provider = new GrokProvider({ spawn, resolveBinary: async () => '/bin/grok' });
    const result = collect(provider, [
      'hello',
      '/repo',
      undefined,
      { abortSignal: controller.signal, ...FORCE_SINGLE_TRANSPORT },
    ]);
    // Wait until the process is actually spawned (and its abort listener
    // attached) before aborting — the fallback notice `system` chunk this
    // path yields first adds an await point ahead of that, so a fixed
    // number of microtask ticks is no longer a reliable proxy.
    await new Promise<void>(resolve => {
      const check = (): void => (spawned ? resolve() : setTimeout(check, 0));
      check();
    });
    controller.abort();

    await expect(result).rejects.toThrow('Query aborted');
    expect(signals).toContain('SIGTERM');
  });

  test('emits the typed turn_not_interruptible signal before any other chunk, for every fallback reason', async () => {
    const fallbackRequestOptions: SendQueryOptions[] = [
      { outputFormat: { type: 'json_schema', schema: { type: 'object' } } },
      {
        nodeConfig: { agents: { reviewer: { description: 'Review', prompt: 'Review carefully' } } },
      },
      { nodeConfig: { allowed_tools: ['read_file'] } },
      { nodeConfig: { denied_tools: ['run_terminal_cmd'] } },
      { systemPrompt: 'be terse' },
      { forkSession: true },
      { assistantConfig: { permissionMode: 'plan' } },
    ];
    for (const requestOptions of fallbackRequestOptions) {
      const config = parseGrokConfig(requestOptions.assistantConfig ?? {});
      const expectedReason = selectGrokTransport({ config, requestOptions });
      if (expectedReason.kind !== 'single') {
        throw new Error('test fixture must select the --single transport');
      }
      const provider = new GrokProvider({
        spawn: () => processFor(['{"type":"end","stopReason":"end_turn","sessionId":"s"}\n']),
        resolveBinary: async () => '/bin/grok',
      });
      const chunks = await collect(provider, ['hello', '/repo', undefined, requestOptions]);
      expect(chunks[0]).toEqual({
        type: 'turn_not_interruptible',
        reason: expectedReason.reason,
      });
      expect(chunks[1]).toMatchObject({ type: 'system' });
    }
  });
});

describe('GrokProvider ACP transport (default)', () => {
  function fakeAcpRunner(
    chunks: MessageChunk[],
    captured: { input?: GrokAcpProcessInput }
  ): GrokAcpTurnRunner {
    return (input => {
      captured.input = input;
      return (async function* (): AsyncGenerator<MessageChunk> {
        for (const chunk of chunks) yield chunk;
      })();
    }) as GrokAcpTurnRunner;
  }

  test('a default request runs the ACP transport with no fallback notice', async () => {
    const captured: { input?: GrokAcpProcessInput } = {};
    const provider = new GrokProvider({
      resolveBinary: async () => '/opt/grok/bin/grok',
      runAcpTurn: fakeAcpRunner(
        [{ type: 'result', sessionId: 'sess-1', stopReason: 'end_turn' }],
        captured
      ),
    });
    const chunks = await collect(provider, ['hello', '/repo']);
    expect(chunks).toEqual([{ type: 'result', sessionId: 'sess-1', stopReason: 'end_turn' }]);
    expect(captured.input).toMatchObject({
      binaryPath: '/opt/grok/bin/grok',
      cwd: '/repo',
      prompt: 'hello',
      resumeSessionId: undefined,
    });
  });

  test('threads model, effort, resumeSessionId, and both signals into the ACP process input', async () => {
    const captured: { input?: GrokAcpProcessInput } = {};
    const provider = new GrokProvider({
      resolveBinary: async () => '/bin/grok',
      runAcpTurn: fakeAcpRunner(
        [{ type: 'result', sessionId: 'sess-resumed', stopReason: 'end_turn' }],
        captured
      ),
    });
    const abortController = new AbortController();
    const interruptController = new AbortController();
    await collect(provider, [
      'redirect',
      '/repo',
      'sess-prior',
      {
        model: 'grok-4.7',
        nodeConfig: { effort: 'high' },
        abortSignal: abortController.signal,
        interruptSignal: interruptController.signal,
      },
    ]);
    expect(captured.input).toMatchObject({
      cwd: '/repo',
      prompt: 'redirect',
      resumeSessionId: 'sess-prior',
      model: 'grok-4.7',
      effort: 'high',
      abortSignal: abortController.signal,
      interruptSignal: interruptController.signal,
    });
  });

  test('a node config needing the fallback transport never reaches runAcpTurn', async () => {
    const captured: { input?: GrokAcpProcessInput } = {};
    let singleSpawned = false;
    const provider = new GrokProvider({
      resolveBinary: async () => '/bin/grok',
      spawn: () => {
        singleSpawned = true;
        return processFor(['{"type":"end","stopReason":"end_turn","sessionId":"s"}\n']);
      },
      runAcpTurn: fakeAcpRunner([], captured),
    });
    const chunks = await collect(provider, ['hello', '/repo', undefined, FORCE_SINGLE_TRANSPORT]);
    expect(captured.input).toBeUndefined();
    expect(singleSpawned).toBe(true);
    const signal = chunks[0] as { type: string; reason: string };
    expect(signal.type).toBe('turn_not_interruptible');
    expect(signal.reason).toContain('--json-schema');
    const notice = chunks[1] as { type: string; content: string };
    expect(notice.type).toBe('system');
    expect(notice.content).toContain('legacy --single transport');
    expect(notice.content).toContain('--json-schema');
  });

  test('a stream-abort marker from the ACP runner passes through unchanged', async () => {
    const captured: { input?: GrokAcpProcessInput } = {};
    const provider = new GrokProvider({
      resolveBinary: async () => '/bin/grok',
      runAcpTurn: fakeAcpRunner(
        [
          {
            type: 'result',
            sessionId: 'sess-interrupted',
            terminalReason: STREAM_ABORTED_TERMINAL_REASON,
            isError: true,
            errorSubtype: STREAM_ABORTED_TERMINAL_REASON,
          },
        ],
        captured
      ),
    });
    const chunks = await collect(provider, ['hello', '/repo']);
    expect(chunks).toEqual([
      {
        type: 'result',
        sessionId: 'sess-interrupted',
        terminalReason: STREAM_ABORTED_TERMINAL_REASON,
        isError: true,
        errorSubtype: STREAM_ABORTED_TERMINAL_REASON,
      },
    ]);
  });

  test('a node-cancel throw from the ACP runner propagates as Query aborted', async () => {
    const captured: { input?: GrokAcpProcessInput } = {};
    const provider = new GrokProvider({
      resolveBinary: async () => '/bin/grok',
      runAcpTurn: (input => {
        captured.input = input;
        // eslint-disable-next-line require-yield -- simulates driveGrokAcpTurn's node-cancel throw, which never yields a chunk first
        return (async function* (): AsyncGenerator<MessageChunk> {
          throw new Error('Query aborted');
        })();
      }) as GrokAcpTurnRunner,
    });
    await expect(collect(provider, ['hello', '/repo'])).rejects.toThrow('Query aborted');
  });

  test('rejects an impossible non-persistent resume before ever calling runAcpTurn', async () => {
    const captured: { input?: GrokAcpProcessInput } = {};
    const provider = new GrokProvider({
      resolveBinary: async () => '/bin/grok',
      runAcpTurn: fakeAcpRunner([], captured),
    });
    await expect(
      collect(provider, ['hello', '/repo', 'old-session', { persistSession: false }])
    ).rejects.toThrow('persistSession is false');
    expect(captured.input).toBeUndefined();
  });
});
