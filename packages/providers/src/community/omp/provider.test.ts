import { afterEach, describe, expect, test } from 'bun:test';

import {
  STREAM_ABORTED_TERMINAL_REASON,
  type MessageChunk,
  type SendQueryOptions,
} from '../../types';
import {
  INTERRUPT_SESSION_HEADER_WAIT_MS,
  OmpProvider,
  buildOmpArgs,
  setTerminationGraceMsForTest,
  type OmpProcess,
  type OmpSpawner,
  type OmpSpawnOptions,
} from './provider';

const encoder = new TextEncoder();

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

interface FakeProcess extends OmpProcess {
  signals: NodeJS.Signals[];
  pushStdout?: (text: string) => void;
  closeStdout?: () => void;
  resolveExit?: (code: number) => void;
}

function makeProcess(stdoutChunks: string[], stderr = '', exitCode = 0): FakeProcess {
  const proc: FakeProcess = {
    stdout: streamFromChunks(stdoutChunks),
    stderr: streamFromChunks([stderr]),
    exited: Promise.resolve(exitCode),
    signals: [],
    kill: (signal = 'SIGTERM'): void => {
      proc.signals.push(signal);
    },
  };
  return proc;
}

function makeRunningProcess(
  exitOn: NodeJS.Signals,
  stdoutFailureOrOptions?:
    | Error
    | {
        stdoutFailure?: Error;
        exitCode?: number;
        /** Delay between matching kill and close/exit (ms). */
        settleDelayMs?: number;
      }
): FakeProcess {
  const options =
    stdoutFailureOrOptions instanceof Error
      ? { stdoutFailure: stdoutFailureOrOptions }
      : (stdoutFailureOrOptions ?? {});
  let stdoutController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let resolveExit: ((code: number) => void) | undefined;
  let reaped = false;
  const settle = (signal: NodeJS.Signals): void => {
    if (signal !== exitOn || reaped) return;
    reaped = true;
    const finish = (): void => {
      if (options.stdoutFailure) stdoutController?.error(options.stdoutFailure);
      else stdoutController?.close();
      resolveExit?.(options.exitCode ?? 0);
    };
    if (options.settleDelayMs && options.settleDelayMs > 0) {
      setTimeout(finish, options.settleDelayMs);
      return;
    }
    finish();
  };
  const proc: FakeProcess = {
    stdout: new ReadableStream<Uint8Array>({
      start(controller): void {
        stdoutController = controller;
      },
    }),
    stderr: streamFromChunks([]),
    exited: new Promise<number>(resolve => {
      resolveExit = resolve;
    }),
    signals: [],
    pushStdout: (text): void => {
      stdoutController?.enqueue(encoder.encode(text));
    },
    kill: (signal = 'SIGTERM'): void => {
      proc.signals.push(signal);
      settle(signal);
    },
  };
  return proc;
}

function makeStderrRejectingProcess(stdoutChunks: string[] = []): FakeProcess {
  let resolveExit: ((code: number) => void) | undefined;
  let reaped = false;
  const proc: FakeProcess = {
    stdout: streamFromChunks(stdoutChunks),
    stderr: new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.error(new Error('stderr read failed'));
      },
    }),
    // Exit only after kill so the provider's terminate path can reap the child.
    exited: new Promise<number>(resolve => {
      resolveExit = resolve;
    }),
    signals: [],
    kill: (signal = 'SIGTERM'): void => {
      proc.signals.push(signal);
      if (!reaped) {
        reaped = true;
        resolveExit?.(0);
      }
    },
  };
  return proc;
}

function makeExitRejectingProcess(stdoutChunks: string[]): FakeProcess {
  const proc: FakeProcess = {
    stdout: streamFromChunks(stdoutChunks),
    stderr: streamFromChunks([]),
    exited: Promise.reject(new Error('exit wait failed')),
    signals: [],
    kill: (signal = 'SIGTERM'): void => {
      proc.signals.push(signal);
    },
  };
  // Prevent unhandled rejection noise if kill races the await.
  void proc.exited.catch(() => undefined);
  return proc;
}

function makeStdoutFailAfterTerminal(stdoutText: string): FakeProcess {
  const payload = encoder.encode(stdoutText.endsWith('\n') ? stdoutText : `${stdoutText}\n`);
  let delivered = false;
  let resolveExit: ((code: number) => void) | undefined;
  let reaped = false;
  const proc: FakeProcess = {
    stdout: new ReadableStream<Uint8Array>({
      pull(controller): void {
        if (!delivered) {
          delivered = true;
          controller.enqueue(payload);
          return;
        }
        controller.error(new Error('stdout read failed'));
      },
    }),
    stderr: streamFromChunks([]),
    exited: new Promise<number>(resolve => {
      resolveExit = resolve;
    }),
    signals: [],
    kill: (signal = 'SIGTERM'): void => {
      proc.signals.push(signal);
      if (!reaped) {
        reaped = true;
        resolveExit?.(0);
      }
    },
  };
  return proc;
}

function successfulLines(sessionId = 'omp-session-1', text = 'Hello'): string[] {
  return [
    JSON.stringify({ type: 'session', id: sessionId }),
    JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } }),
    JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: text },
    }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        usage: { input: 3, output: 2, totalTokens: 5, cost: { total: 0.1 } },
        stopReason: 'stop',
      },
    }),
    JSON.stringify({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'README.md' },
    }),
    JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'read',
      result: 'contents',
      isError: false,
    }),
    JSON.stringify({ type: 'agent_end', messages: [] }),
  ];
}

function modelErrorLines(): string[] {
  return [
    JSON.stringify({ type: 'session', id: 'model-error-session' }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '{"answer":"partial"}' }],
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        usage: { input: 7, output: 4, totalTokens: 11, cost: { total: 0.3 } },
        stopReason: 'error',
        errorMessage: 'rate limited',
      },
    }),
    '{bad json',
  ];
}

function makeSpawner(
  proc: FakeProcess,
  calls: { command: string[]; options: OmpSpawnOptions }[]
): OmpSpawner {
  return (command, options): OmpProcess => {
    calls.push({ command, options });
    return proc;
  };
}

async function collect(
  provider: OmpProvider,
  resumeSessionId?: string,
  requestOptions: SendQueryOptions = {}
): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of provider.sendQuery('hello', '/repo', resumeSessionId, {
    ...requestOptions,
    env: { OMP_BIN_PATH: process.execPath, ...requestOptions.env },
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for test condition.');
}

describe('buildOmpArgs', () => {
  test('builds a safe headless OMP command', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: {
        model: 'openai-codex/gpt-6-sol',
        modelReasoningEffort: 'high',
      },
      requestOptions: {
        systemPrompt: ['first', 'second'],
        nodeConfig: { skills: ['archon', 'review-*'] },
      },
    });

    expect(result.args).toEqual([
      '--mode',
      'json',
      '--cwd',
      '/repo',
      '--yolo',
      '--no-title',
      '--no-extensions',
      '--model',
      'openai-codex/gpt-6-sol',
      '--thinking',
      'high',
      '--system-prompt',
      'first\n\nsecond',
      '--skills',
      'archon,review-*',
      '--',
      'hello',
    ]);
  });

  test('uses request model and string thinking before assistant defaults', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: { model: 'fallback/model', modelReasoningEffort: 'low' },
      requestOptions: {
        model: 'selected/model',
        nodeConfig: { thinking: 'off', effort: 'future-effort' },
      },
    });
    expect(result.args).toContain('selected/model');
    expect(result.thinking).toBe('off');
  });

  test('passes raw effort unchanged when string thinking is absent', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: {},
      requestOptions: { nodeConfig: { effort: '  future-omp  ' } },
    });
    expect(result.thinking).toBe('  future-omp  ');
  });

  test('uses resume, fork, and in-memory flags without inventing session ids', () => {
    const resumeArgs = buildOmpArgs({
      prompt: 'a',
      cwd: '/repo',
      config: {},
      resumeSessionId: 'session-1',
    }).args;
    const resumeIndex = resumeArgs.indexOf('--resume');
    expect(resumeIndex).toBeGreaterThan(-1);
    expect(resumeArgs[resumeIndex + 1]).toBe('session-1');

    const forkArgs = buildOmpArgs({
      prompt: 'b',
      cwd: '/repo',
      config: {},
      resumeSessionId: 'session-1',
      requestOptions: { forkSession: true },
    }).args;
    const forkIndex = forkArgs.indexOf('--fork');
    expect(forkIndex).toBeGreaterThan(-1);
    expect(forkArgs[forkIndex + 1]).toBe('session-1');

    expect(
      buildOmpArgs({
        prompt: 'c',
        cwd: '/repo',
        config: {},
        requestOptions: { persistSession: false },
      }).args
    ).toContain('--no-session');
  });

  test('rejects resume when persistence is disabled', () => {
    expect(() =>
      buildOmpArgs({
        prompt: 'hello',
        cwd: '/repo',
        config: {},
        resumeSessionId: 'session-1',
        requestOptions: { persistSession: false },
      })
    ).toThrow('cannot resume');
  });

  test('omits no-extensions only after explicit opt-in', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: { enableExtensions: true },
    });
    expect(result.args).not.toContain('--no-extensions');
  });
});

describe('OmpProvider', () => {
  test('streams fragmented NDJSON and emits the concrete session result', async () => {
    const ndjson = successfulLines().join('\r\n');
    const proc = makeProcess([ndjson.slice(0, 17), ndjson.slice(17, 91), ndjson.slice(91)]);
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }));

    expect(calls).toHaveLength(1);
    expect(chunks).toContainEqual({ type: 'assistant', content: 'Hello' });
    expect(chunks).toContainEqual({
      type: 'tool',
      toolName: 'read',
      toolInput: { path: 'README.md' },
      toolCallId: 'tool-1',
    });
    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'read',
      toolOutput: 'contents',
      toolCallId: 'tool-1',
      toolOutcome: 'success',
      outputState: 'full',
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'omp-session-1',
      tokens: { input: 3, output: 2, total: 5, cost: 0.1 },
      cost: 0.1,
      stopReason: 'stop',
      resolvedModel: { id: 'openai-codex/gpt-6-sol' },
    });
  });

  test('marks a successful resumed stream as resumed', async () => {
    const proc = makeProcess([successfulLines('new-session').join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), 'old-session');
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'new-session',
      resumed: true,
    });
  });

  test('maps a non-zero exit with stderr diagnostics', async () => {
    const proc = makeProcess([], 'missing credentials', 2);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), 'old-session');
    expect(chunks.at(-2)).toMatchObject({
      type: 'system',
      content: expect.stringContaining('setup'),
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_exit_nonzero',
      resumed: false,
    });
  });

  test('preserves parser metadata on a non-zero exit result', async () => {
    const proc = makeProcess(
      [successfulLines('exit-session', '{"answer":"ok"}').join('\n')],
      'process failed',
      2
    );
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      outputFormat: { type: 'json_schema', schema: { type: 'object' } },
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'exit-session',
      tokens: { input: 3, output: 2, total: 5, cost: 0.1 },
      cost: 0.1,
      stopReason: 'stop',
      numTurns: 1,
      resolvedModel: { id: 'openai-codex/gpt-6-sol' },
      structuredOutput: { answer: 'ok' },
      isError: true,
      errorSubtype: 'omp_exit_nonzero',
    });
  });

  test('maps exit zero without agent_end to incomplete output', async () => {
    const proc = makeProcess([[JSON.stringify({ type: 'session', id: 'incomplete' })].join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'incomplete',
      isError: true,
      errorSubtype: 'omp_incomplete_output',
    });
  });

  test('completes successfully when OMP exits 0 after a finished turn without agent_end', async () => {
    const proc = makeProcess([successfulLines('no-end-session').slice(0, -1).join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'no-end-session',
      stopReason: 'stop',
    });
    expect(chunks.at(-1)).not.toHaveProperty('isError');
  });

  test('maps malformed JSON to a protocol error and kills the child', async () => {
    const proc = makeRunningProcess('SIGTERM');
    const chunksPromise = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(
      `${JSON.stringify({ type: 'session', id: 'protocol-session' })}\n{bad json\n`
    );
    const chunks = await chunksPromise;
    expect(proc.signals).toContain('SIGTERM');
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'protocol-session',
      isError: true,
      errorSubtype: 'omp_protocol_error',
    });
  });

  test('preserves parser metadata and model errors on a protocol error result', async () => {
    const proc = makeProcess([modelErrorLines().join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      outputFormat: { type: 'json_schema', schema: { type: 'object' } },
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'model-error-session',
      tokens: { input: 7, output: 4, total: 11, cost: 0.3 },
      cost: 0.3,
      stopReason: 'error',
      numTurns: 1,
      resolvedModel: { id: 'openai-codex/gpt-6-sol' },
      structuredOutput: { answer: 'partial' },
      isError: true,
      errorSubtype: 'omp_protocol_error',
      errors: expect.arrayContaining(['rate limited']),
    });
  });

  test('completes successfully when OMP emits maintenance events after agent_end', async () => {
    const proc = makeProcess([
      [
        ...successfulLines('trail-session'),
        JSON.stringify({ type: 'notice', message: 'Todo completion reminder' }),
        JSON.stringify({ type: 'custom_message', customType: 'advisor' }),
      ].join('\n'),
    ]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'trail-session',
      stopReason: 'stop',
    });
    expect(chunks.at(-1)).not.toHaveProperty('isError');
    expect(proc.signals).not.toContain('SIGTERM');
  });

  test('warns before spawn for object-form thinking and falls back to effort', async () => {
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const proc = makeProcess([successfulLines().join('\n')]);
    const iterator = new OmpProvider({ spawn: makeSpawner(proc, calls) }).sendQuery(
      'hello',
      '/repo',
      undefined,
      {
        env: { OMP_BIN_PATH: process.execPath },
        nodeConfig: { thinking: { type: 'enabled' }, effort: 'high' },
      }
    );
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'system', content: expect.stringContaining('object-form') },
    });
    expect(calls).toHaveLength(0);
    await iterator.next();
    expect(calls[0]?.command).toContain('high');
    await iterator.return(undefined);
  });

  test('rejects a pre-aborted request without spawning', async () => {
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const controller = new AbortController();
    controller.abort();
    const provider = new OmpProvider({ spawn: makeSpawner(makeProcess([]), calls) });
    await expect(
      collect(provider, undefined, { abortSignal: controller.signal, env: { OMP_BIN_PATH: '' } })
    ).rejects.toThrow('Query aborted');
    expect(calls).toHaveLength(0);
  });

  test('escalates an aborted stream from SIGTERM to SIGKILL', async () => {
    const proc = makeRunningProcess('SIGKILL');
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const controller = new AbortController();
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      abortSignal: controller.signal,
    });
    await waitFor(() => calls.length === 1);
    controller.abort();
    await expect(run).rejects.toThrow('Query aborted');
    expect(proc.signals).toEqual(['SIGTERM', 'SIGKILL']);
  }, 7_000);

  test('reports abort when SIGTERM makes stdout reject', async () => {
    const proc = makeRunningProcess('SIGTERM', new Error('stdout read failed'));
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const controller = new AbortController();
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      abortSignal: controller.signal,
    });
    await waitFor(() => calls.length === 1);
    controller.abort();
    await expect(run).rejects.toThrow('Query aborted');
    expect(proc.signals).toEqual(['SIGTERM']);
  });

  test('tears down and reaps after an early stderr read rejection', async () => {
    const proc = makeStderrRejectingProcess();
    await expect(collect(new OmpProvider({ spawn: makeSpawner(proc, []) }))).rejects.toThrow(
      'stderr read failed'
    );
    expect(proc.signals).toEqual(['SIGTERM']);
  });

  test('preserves parsed usage once when stderr rejects after a terminal turn', async () => {
    const proc = makeStderrRejectingProcess([successfulLines('usage-stderr-session').join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    const results = chunks.filter(chunk => chunk.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_transport_error',
      sessionId: 'usage-stderr-session',
      tokens: { input: 3, output: 2, total: 5, cost: 0.1 },
      cost: 0.1,
      stopReason: 'stop',
      resolvedModel: { id: 'openai-codex/gpt-6-sol' },
      usageBreakdown: [
        {
          provider: 'openai-codex',
          model: 'gpt-6-sol',
          modelSource: 'reported',
          inputTokens: 3,
          outputTokens: 2,
          costUsd: 0.1,
        },
      ],
      errors: ['stderr read failed'],
    });
    expect(proc.signals).toEqual(['SIGTERM']);
  });

  test('preserves parsed usage once when process.exited rejects after a terminal turn', async () => {
    const proc = makeExitRejectingProcess([successfulLines('usage-exit-session').join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    const results = chunks.filter(chunk => chunk.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_transport_error',
      sessionId: 'usage-exit-session',
      usageBreakdown: [
        {
          provider: 'openai-codex',
          model: 'gpt-6-sol',
          modelSource: 'reported',
          inputTokens: 3,
          outputTokens: 2,
          costUsd: 0.1,
        },
      ],
      errors: ['exit wait failed'],
    });
  });

  test('preserves parsed usage once when stdout fails after the terminal event', async () => {
    const proc = makeStdoutFailAfterTerminal(successfulLines('usage-stdout-session').join('\n'));
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    const results = chunks.filter(chunk => chunk.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_transport_error',
      sessionId: 'usage-stdout-session',
      usageBreakdown: [
        {
          provider: 'openai-codex',
          model: 'gpt-6-sol',
          modelSource: 'reported',
          inputTokens: 3,
          outputTokens: 2,
          costUsd: 0.1,
        },
      ],
      errors: ['stdout read failed'],
    });
  });

  test('throws on exit rejection with no parsed usage and does not invent observations', async () => {
    const proc = makeExitRejectingProcess([]);
    await expect(collect(new OmpProvider({ spawn: makeSpawner(proc, []) }))).rejects.toThrow(
      'exit wait failed'
    );
  });

  test('overlays request environment values on defined process values', async () => {
    const key = 'ARCHON_OMP_PROVIDER_TEST';
    const original = process.env[key];
    process.env[key] = 'base';
    try {
      const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
      const proc = makeProcess([successfulLines().join('\n')]);
      await collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
        env: { [key]: 'request' },
      });
      expect(calls[0]?.options.env[key]).toBe('request');
      const envPath = calls[0]?.options.env.PATH ?? calls[0]?.options.env.Path;
      expect(envPath).toBeDefined();
    } finally {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  test('augments JSON-schema prompts and returns parsed structured output', async () => {
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const proc = makeProcess([successfulLines('json-session', '{"answer":"ok"}').join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      outputFormat: {
        type: 'json_schema',
        schema: { type: 'object', properties: { answer: { type: 'string' } } },
      },
    });
    expect(calls[0]?.command.at(-1)).toContain('CRITICAL: Respond with ONLY a JSON object');
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      structuredOutput: { answer: 'ok' },
    });
  });

  test('clears the escalation timer after early close reaps the child', async () => {
    const proc = makeRunningProcess('SIGTERM');
    const iterator = new OmpProvider({ spawn: makeSpawner(proc, []) }).sendQuery(
      'hello',
      '/repo',
      undefined,
      { env: { OMP_BIN_PATH: process.execPath } }
    );
    const firstChunk = iterator.next();
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(`${successfulLines().slice(0, 4).join('\n')}\n`);
    await expect(firstChunk).resolves.toMatchObject({
      value: { type: 'assistant', content: 'Hello' },
    });
    await iterator.return(undefined);
    await new Promise(resolve => setTimeout(resolve, 5_100));
    expect(proc.signals).toEqual(['SIGTERM']);
  }, 7_000);
});

function makeControllableProcess(options?: {
  exitOn?: NodeJS.Signals | 'manual';
  stdoutFailure?: Error;
}): FakeProcess {
  const exitOn = options?.exitOn ?? 'manual';
  let stdoutController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const exitGate = Promise.withResolvers<number>();
  let exitResolved = false;
  let stdoutClosed = false;
  const closeStdoutSafe = (fail?: Error): void => {
    if (stdoutClosed) return;
    stdoutClosed = true;
    try {
      if (fail) stdoutController?.error(fail);
      else stdoutController?.close();
    } catch {
      // Controller may already be closed by the reader.
    }
  };
  const finish = (code: number, fail?: Error): void => {
    if (exitResolved) return;
    exitResolved = true;
    closeStdoutSafe(fail);
    exitGate.resolve(code);
  };
  const proc: FakeProcess = {
    stdout: new ReadableStream<Uint8Array>({
      start(controller): void {
        stdoutController = controller;
      },
    }),
    stderr: streamFromChunks([]),
    exited: exitGate.promise,
    signals: [],
    pushStdout: (text): void => {
      if (stdoutClosed) return;
      stdoutController?.enqueue(encoder.encode(text));
    },
    closeStdout: (): void => {
      closeStdoutSafe();
    },
    resolveExit: (code): void => {
      finish(code);
    },
    kill: (signal = 'SIGTERM'): void => {
      proc.signals.push(signal);
      if (exitOn === 'manual') return;
      if (signal === exitOn) finish(0, options?.stdoutFailure);
    },
  };
  return proc;
}

describe('OmpProvider interrupt / stream-abort seam', () => {
  afterEach(() => {
    setTerminationGraceMsForTest(undefined);
  });

  test('never-aborted interruptSignal matches no-signal argv and chunks; late abort sends nothing', async () => {
    const baselineCalls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const baselineProc = makeProcess([successfulLines('base-session').join('\n')]);
    const baseline = await collect(
      new OmpProvider({ spawn: makeSpawner(baselineProc, baselineCalls) })
    );

    const interrupt = new AbortController();
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const proc = makeProcess([successfulLines('base-session').join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      interruptSignal: interrupt.signal,
    });

    expect(calls[0]?.command).toEqual(baselineCalls[0]?.command);
    expect(chunks).toEqual(baseline);
    expect(proc.signals).toEqual([]);

    interrupt.abort();
    await waitFor(() => true);
    expect(proc.signals).toEqual([]);
  });

  test('immediate fresh-turn Stop still spawns, waits for session header, one SIGTERM, real id', async () => {
    const interrupt = new AbortController();
    interrupt.abort();
    const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => calls.length === 1);
    expect(proc.signals).toEqual([]);
    proc.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'fresh-int' })}\n`);
    const chunks = await run;
    expect(proc.signals).toEqual(['SIGTERM']);
    expect(chunks.filter(c => c.type === 'result')).toHaveLength(1);
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'fresh-int',
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
    });
    expect(chunks.at(-1)).not.toHaveProperty('isError');
    expect(chunks.at(-1)).not.toHaveProperty('stopReason');
  });

  test('turn event before session header yields unmarked omp_interrupt_session_unavailable', async () => {
    const interrupt = new AbortController();
    const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => calls.length === 1);
    interrupt.abort();
    proc.pushStdout?.(
      `${JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } })}\n`
    );
    const chunks = await run;
    expect(proc.signals).toEqual(['SIGTERM']);
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_interrupt_session_unavailable',
    });
    expect(chunks.at(-1)).not.toHaveProperty('terminalReason');
    expect(chunks.at(-1)).not.toHaveProperty('sessionId');
  });

  test('500 ms header timeout yields unmarked omp_interrupt_session_unavailable', async () => {
    const interrupt = new AbortController();
    interrupt.abort();
    const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => calls.length === 1);
    expect(proc.signals).toEqual([]);
    await waitFor(() => proc.signals.includes('SIGTERM'), 1_500);
    const chunks = await run;
    expect(proc.signals).toEqual(['SIGTERM']);
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_interrupt_session_unavailable',
    });
    expect(chunks.at(-1)).not.toHaveProperty('terminalReason');
  }, 2_000);

  test('mid-text Stop drains coalesced deltas once then one marked result without completion/error fields', async () => {
    const interrupt = new AbortController();
    const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => calls.length === 1);
    proc.pushStdout?.(
      [
        JSON.stringify({ type: 'session', id: 'mid-text' }),
        JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } }),
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'Hel' },
        }),
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'lo' },
        }),
      ].join('\n') + '\n'
    );
    await waitFor(() => proc.stdout?.locked === true);
    interrupt.abort();
    const chunks = await run;
    expect(chunks.filter(c => c.type === 'assistant')).toEqual([
      { type: 'assistant', content: 'Hello' },
    ]);
    const results = chunks.filter(c => c.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      sessionId: 'mid-text',
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
    });
    expect(results[0]).not.toHaveProperty('isError');
    expect(results[0]).not.toHaveProperty('stopReason');
    expect(results[0]).not.toHaveProperty('errorSubtype');
    expect(results[0]).not.toHaveProperty('errors');
    expect(results[0]).not.toHaveProperty('structuredOutput');
  });

  test('active-tool Stop maps errored end to interrupted, late success stays success, open tool stays open', async () => {
    const interrupt = new AbortController();
    const proc = makeControllableProcess({ exitOn: 'manual' });
    const it = new OmpProvider({ spawn: makeSpawner(proc, []) }).sendQuery(
      'hello',
      '/repo',
      undefined,
      {
        env: { OMP_BIN_PATH: process.execPath },
        interruptSignal: interrupt.signal,
      }
    );
    const firstNext = it.next();
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(
      [
        JSON.stringify({ type: 'session', id: 'tool-late' }),
        JSON.stringify({
          type: 'tool_execution_start',
          toolCallId: 't-err',
          toolName: 'bash',
          args: { command: 'x' },
        }),
        JSON.stringify({
          type: 'tool_execution_start',
          toolCallId: 't-ok',
          toolName: 'read',
          args: { path: 'a' },
        }),
        JSON.stringify({
          type: 'tool_execution_start',
          toolCallId: 't-open',
          toolName: 'bash',
          args: { command: 'sleep' },
        }),
      ].join('\n') + '\n'
    );
    // Consume tool starts so interrupt ownership snapshots active tools.
    const early: MessageChunk[] = [];
    const first = await firstNext;
    if (first.done || !first.value) throw new Error('expected first tool start chunk');
    early.push(first.value);
    for (let i = 0; i < 2; i += 1) {
      const next = await it.next();
      if (next.done || !next.value) throw new Error('expected tool start chunk');
      early.push(next.value);
    }
    expect(early.every(c => c.type === 'tool')).toBe(true);
    interrupt.abort();
    await waitFor(() => proc.signals[0] === 'SIGTERM');
    proc.pushStdout?.(
      [
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 't-err',
          toolName: 'bash',
          isError: true,
          result: 'aborted',
        }),
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 't-ok',
          toolName: 'read',
          isError: false,
          result: 'ok',
        }),
      ].join('\n') + '\n'
    );
    // Let the provider read the tool ends before reaping.
    const mid: MessageChunk[] = [];
    for (let i = 0; i < 2; i += 1) {
      const next = await it.next();
      if (next.done || !next.value) throw new Error('expected tool end chunk');
      mid.push(next.value);
    }
    proc.closeStdout?.();
    proc.resolveExit?.(0);
    const rest: MessageChunk[] = [];
    for await (const chunk of it) rest.push(chunk);
    const chunks = [...early, ...mid, ...rest];
    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'bash',
      toolOutput: 'aborted',
      toolCallId: 't-err',
      toolOutcome: 'interrupted',
      outputState: 'full',
    });
    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'read',
      toolOutput: 'ok',
      toolCallId: 't-ok',
      toolOutcome: 'success',
      outputState: 'full',
    });
    expect(chunks.some(c => c.type === 'tool_result' && c.toolCallId === 't-open')).toBe(false);
    expect(chunks.filter(c => c.type === 'system')).toEqual([]);
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'tool-late',
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
    });
    expect(proc.signals).toEqual(['SIGTERM']);
  });

  test('Cancel alone and Cancel+Stop keep Query aborted; co-fire sends at most one SIGTERM', async () => {
    const cancelOnly = new AbortController();
    const procA = makeControllableProcess({ exitOn: 'SIGTERM' });
    const callsA: { command: string[]; options: OmpSpawnOptions }[] = [];
    const runA = collect(new OmpProvider({ spawn: makeSpawner(procA, callsA) }), undefined, {
      abortSignal: cancelOnly.signal,
    });
    await waitFor(() => callsA.length === 1);
    cancelOnly.abort();
    await expect(runA).rejects.toThrow('Query aborted');
    expect(procA.signals).toEqual(['SIGTERM']);

    const cancel = new AbortController();
    const interrupt = new AbortController();
    const procB = makeControllableProcess({ exitOn: 'SIGTERM' });
    const callsB: { command: string[]; options: OmpSpawnOptions }[] = [];
    const runB = collect(new OmpProvider({ spawn: makeSpawner(procB, callsB) }), undefined, {
      abortSignal: cancel.signal,
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => callsB.length === 1);
    procB.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'cofire' })}\n`);
    await waitFor(() => true);
    interrupt.abort();
    cancel.abort();
    await expect(runB).rejects.toThrow('Query aborted');
    expect(procB.signals.filter(s => s === 'SIGTERM')).toHaveLength(1);
  });

  test('interrupt-owned truncated JSON after SIGTERM stays marked graceful result', async () => {
    const interrupt = new AbortController();
    const proc = makeControllableProcess({ exitOn: 'manual' });
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'trunc' })}\n`);
    await waitFor(() => true);
    interrupt.abort();
    await waitFor(() => proc.signals.includes('SIGTERM'));
    proc.pushStdout?.('{bad json\n');
    proc.closeStdout?.();
    proc.resolveExit?.(0);
    const chunks = await run;
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'trunc',
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
    });
    expect(chunks.at(-1)).not.toHaveProperty('isError');
  });

  test('interrupt-owned stdout rejection after SIGTERM stays marked graceful result', async () => {
    const interrupt = new AbortController();
    const proc = makeControllableProcess({
      exitOn: 'SIGTERM',
      stdoutFailure: new Error('stdout read failed'),
    });
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'rej' })}\n`);
    await waitFor(() => true);
    interrupt.abort();
    const chunks = await run;
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'rej',
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
    });
    expect(chunks.at(-1)).not.toHaveProperty('isError');
  });

  test('protocol error that owns termination before Stop retains original error', async () => {
    const interrupt = new AbortController();
    const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'proto' })}\n{bad json\n`);
    await waitFor(() => proc.signals.includes('SIGTERM'));
    interrupt.abort();
    const chunks = await run;
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'proto',
      isError: true,
      errorSubtype: 'omp_protocol_error',
    });
    expect(chunks.at(-1)).not.toHaveProperty('terminalReason');
  });

  test('a non-zero process exit that wins before Stop remains an unmarked failure', async () => {
    const interrupt = new AbortController();
    const proc = makeControllableProcess({ exitOn: 'manual' });
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'exit-first' })}\n`);
    proc.closeStdout?.();
    proc.resolveExit?.(1);
    await waitFor(() => proc.signals.length === 0);
    interrupt.abort();

    const chunks = await run;
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'exit-first',
      isError: true,
      errorSubtype: 'omp_exit_nonzero',
    });
    expect(chunks.at(-1)).not.toHaveProperty('terminalReason');
    expect(proc.signals).toEqual([]);
  });

  test('agent_end then Stop before process close remains normal unmarked result', async () => {
    const interrupt = new AbortController();
    const proc = makeControllableProcess({ exitOn: 'manual' });
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(`${successfulLines('natural-end').join('\n')}\n`);
    await waitFor(() => true);
    interrupt.abort();
    proc.closeStdout?.();
    proc.resolveExit?.(0);
    const chunks = await run;
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'natural-end',
      stopReason: 'stop',
    });
    expect(chunks.at(-1)).not.toHaveProperty('terminalReason');
    expect(chunks.at(-1)).not.toHaveProperty('isError');
    expect(proc.signals).toEqual([]);
  });

  test('forced escalation emits omp_interrupt_force_killed without interrupt marker', async () => {
    setTerminationGraceMsForTest(20);
    const interrupt = new AbortController();
    const proc = makeControllableProcess({ exitOn: 'SIGKILL' });
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'force' })}\n`);
    await waitFor(() => true);
    interrupt.abort();
    const chunks = await run;
    expect(proc.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'force',
      isError: true,
      errorSubtype: 'omp_interrupt_force_killed',
    });
    expect(chunks.at(-1)).not.toHaveProperty('terminalReason');
  });

  test('fresh process exit before session header is incomplete/error, never fabricated interrupted session', async () => {
    const interrupt = new AbortController();
    interrupt.abort();
    const proc = makeControllableProcess({ exitOn: 'manual' });
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => calls.length === 1);
    expect(proc.signals).toEqual([]);
    proc.closeStdout?.();
    proc.resolveExit?.(0);
    const chunks = await run;
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_incomplete_output',
    });
    expect(chunks.at(-1)).not.toHaveProperty('sessionId');
    expect(chunks.at(-1)).not.toHaveProperty('terminalReason');
    // Header wait must not later SIGTERM a finished process.
    await waitFor(() => true);
    expect(proc.signals).toEqual([]);
  });

  test('interrupted resume equality/mismatch and fork-with/without-header set resumed conservatively', async () => {
    {
      const interrupt = new AbortController();
      const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
      const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), 'same-id', {
        interruptSignal: interrupt.signal,
      });
      await waitFor(() => proc.stdout?.locked === true);
      proc.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'same-id' })}\n`);
      await waitFor(() => true);
      interrupt.abort();
      const chunks = await run;
      expect(chunks.at(-1)).toMatchObject({
        terminalReason: STREAM_ABORTED_TERMINAL_REASON,
        resumed: true,
        sessionId: 'same-id',
      });
    }
    {
      const interrupt = new AbortController();
      const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
      const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), 'wanted', {
        interruptSignal: interrupt.signal,
      });
      await waitFor(() => proc.stdout?.locked === true);
      proc.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'other' })}\n`);
      await waitFor(() => true);
      interrupt.abort();
      const chunks = await run;
      expect(chunks.at(-1)).toMatchObject({
        terminalReason: STREAM_ABORTED_TERMINAL_REASON,
        resumed: false,
        sessionId: 'other',
      });
    }
    {
      const interrupt = new AbortController();
      const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
      const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), 'seed', {
        interruptSignal: interrupt.signal,
        forkSession: true,
      });
      await waitFor(() => proc.stdout?.locked === true);
      proc.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'forked' })}\n`);
      await waitFor(() => true);
      interrupt.abort();
      const chunks = await run;
      expect(chunks.at(-1)).toMatchObject({
        terminalReason: STREAM_ABORTED_TERMINAL_REASON,
        resumed: true,
        sessionId: 'forked',
      });
    }
    {
      // Fork without observed header → interrupt-unresumable (no fabricated id).
      const interrupt = new AbortController();
      interrupt.abort();
      const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
      const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), 'seed', {
        interruptSignal: interrupt.signal,
        forkSession: true,
      });
      await waitFor(() => proc.signals.includes('SIGTERM'), 1_500);
      const chunks = await run;
      expect(chunks.at(-1)).toMatchObject({
        isError: true,
        errorSubtype: 'omp_interrupt_session_unavailable',
      });
      expect(chunks.at(-1)).not.toHaveProperty('resumed');
      expect(chunks.at(-1)).not.toHaveProperty('sessionId');
    }
  });

  test('observed primary usage survives the interrupt path', async () => {
    const interrupt = new AbortController();
    const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(
      [
        JSON.stringify({ type: 'session', id: 'usage-int' }),
        JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } }),
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'Hi' },
        }),
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi' }],
            provider: 'openai-codex',
            model: 'gpt-6-sol',
            usage: { input: 3, output: 2, totalTokens: 5, cost: { total: 0.1 } },
            stopReason: 'stop',
          },
        }),
      ].join('\n') + '\n'
    );
    await waitFor(() => true);
    interrupt.abort();
    const chunks = await run;
    expect(chunks.filter(c => c.type === 'assistant')).toEqual([
      { type: 'assistant', content: 'Hi' },
    ]);
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'usage-int',
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
      tokens: { input: 3, output: 2, total: 5, cost: 0.1 },
      cost: 0.1,
      numTurns: 1,
      resolvedModel: { id: 'openai-codex/gpt-6-sol' },
      usageBreakdown: [
        {
          provider: 'openai-codex',
          model: 'gpt-6-sol',
          modelSource: 'reported',
          inputTokens: 3,
          outputTokens: 2,
          requests: 1,
          costUsd: 0.1,
        },
      ],
    });
    expect(chunks.at(-1)).not.toHaveProperty('stopReason');
  });

  test('listener/timer cleanup holds after graceful interrupt without later SIGKILL', async () => {
    setTerminationGraceMsForTest(30);
    const interrupt = new AbortController();
    const proc = makeControllableProcess({ exitOn: 'SIGTERM' });
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(`${JSON.stringify({ type: 'session', id: 'cleanup' })}\n`);
    await waitFor(() => true);
    interrupt.abort();
    await run;
    await waitFor(() => true);
    // Allow shortened grace window to elapse; SIGKILL must not fire after graceful reap.
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 50);
    await promise;
    expect(proc.signals).toEqual(['SIGTERM']);
  });
});
