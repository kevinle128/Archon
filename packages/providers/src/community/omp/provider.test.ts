import { afterEach, describe, expect, test } from 'bun:test';

import {
  STREAM_ABORTED_TERMINAL_REASON,
  type MessageChunk,
  type SendQueryOptions,
} from '../../types';
import {
  OmpProvider,
  buildOmpArgs,
  setTerminationGraceMsForTest,
  setWarmSessionIdleEvictionMsForTest,
  type OmpRpcProcess,
  type OmpRpcSpawner,
  type OmpRpcSpawnOptions,
} from './provider';

const encoder = new TextEncoder();
const DEFAULT_SESSION_ID = 'omp-rpc-session-1';

// File-wide small overrides so a warm session's real (5s / 40min) production
// timers never dangle past a test that doesn't care about their exact value —
// only the tests that assert on escalation/eviction TIMING itself override
// further, and restore these file defaults afterward.
const TEST_GRACE_MS = 25;
const TEST_IDLE_EVICTION_MS = 50;
setTerminationGraceMsForTest(TEST_GRACE_MS);
setWarmSessionIdleEvictionMsForTest(TEST_IDLE_EVICTION_MS);

interface SpawnCall {
  command: string[];
  options: OmpRpcSpawnOptions;
}

/**
 * Fake `--mode rpc` child. Emits `ready` on open; auto-acknowledges
 * `get_state` (with `sessionId`) and `prompt` writes unless a test disables
 * one to exercise a rejection path. Every write is captured, parsed, in
 * `writes` for assertions.
 */
interface FakeRpcProcess extends OmpRpcProcess {
  readonly writes: Record<string, unknown>[];
  readonly signals: NodeJS.Signals[];
  stdinEnded: boolean;
  push(frame: Record<string, unknown>): void;
  pushRaw(text: string): void;
  closeStdout(): void;
  errorStdout(error: Error): void;
  resolveExit(code: number): void;
  /**
   * Queues one turn's frames to be pushed automatically, in order,
   * immediately after the NEXT `prompt` write is auto-acked (FIFO across
   * multiple turns). Real OMP never emits agent-turn events before it has
   * received a prompt, so a test must not pre-push them onto the stream
   * before that write happens — pushing eagerly races the ready/get_state
   * handshake, which drains and discards any frame it does not recognize.
   */
  queueTurn(frames: Record<string, unknown>[]): void;
}

function makeFakeRpcProcess(
  options: {
    sessionId?: string;
    autoAckGetState?: boolean;
    autoAckPrompt?: boolean;
    pid?: number;
  } = {}
): FakeRpcProcess {
  const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
  const autoAckGetState = options.autoAckGetState ?? true;
  const autoAckPrompt = options.autoAckPrompt ?? true;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let started = false;
  let stdoutClosed = false;
  const exitGate = Promise.withResolvers<number>();
  const writes: Record<string, unknown>[] = [];
  const signals: NodeJS.Signals[] = [];
  const queuedTurns: Record<string, unknown>[][] = [];
  // `ReadableStream`'s `start()` is not guaranteed to run before this
  // function returns, so a `push()` called synchronously right after
  // construction (every test does this) must not depend on `controller`
  // already being assigned — buffer until `start()` flushes it, in order.
  const preStartBuffer: Uint8Array[] = [];

  const enqueue = (bytes: Uint8Array): void => {
    if (stdoutClosed) return;
    if (started && controller) controller.enqueue(bytes);
    else preStartBuffer.push(bytes);
  };
  const push = (frame: Record<string, unknown>): void => {
    enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
  };

  const proc: FakeRpcProcess = {
    pid: options.pid ?? 4242,
    stdout: new ReadableStream<Uint8Array>({
      start(c): void {
        controller = c;
        c.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: 'ready',
              protocolVersion: 1,
              supportedProtocolVersions: [1, 2],
              maxFrameBytes: 1048576,
              maxReassembledFrameBytes: 67108864,
            })}\n`
          )
        );
        started = true;
        for (const bytes of preStartBuffer) c.enqueue(bytes);
        preStartBuffer.length = 0;
      },
    }),
    stderr: new ReadableStream<Uint8Array>({
      start(c): void {
        c.close();
      },
    }),
    exited: exitGate.promise,
    writes,
    signals,
    stdinEnded: false,
    write: (data: string): void => {
      for (const line of data.split('\n')) {
        if (line.trim().length === 0) continue;
        const frame = JSON.parse(line) as Record<string, unknown>;
        writes.push(frame);
        if (autoAckGetState && frame.type === 'get_state') {
          push({
            type: 'response',
            id: frame.id,
            command: 'get_state',
            success: true,
            data: { sessionId },
          });
        }
        if (autoAckPrompt && frame.type === 'prompt') {
          push({ type: 'response', id: frame.id, command: 'prompt', success: true });
          const batch = queuedTurns.shift();
          if (batch) for (const turnFrame of batch) push(turnFrame);
        }
      }
    },
    endStdin: (): void => {
      proc.stdinEnded = true;
      resolveExit(0);
    },
    kill: (signal: NodeJS.Signals = 'SIGTERM'): void => {
      signals.push(signal);
      // Mirrors real process semantics for these tests: SIGKILL always
      // resolves immediately; SIGTERM may be ignored, which is exactly what
      // the escalation-timer tests need to exercise.
      if (signal === 'SIGKILL') resolveExit(-9);
    },
    push,
    pushRaw: (text: string): void => {
      enqueue(encoder.encode(text));
    },
    closeStdout: (): void => {
      if (stdoutClosed) return;
      stdoutClosed = true;
      controller?.close();
    },
    errorStdout: (error: Error): void => {
      if (stdoutClosed) return;
      stdoutClosed = true;
      controller?.error(error);
    },
    resolveExit,
    queueTurn: (frames: Record<string, unknown>[]): void => {
      queuedTurns.push(frames);
    },
  };

  let exitResolved = false;
  function resolveExit(code: number): void {
    if (exitResolved) return;
    exitResolved = true;
    proc.closeStdout();
    exitGate.resolve(code);
  }

  return proc;
}

function makeSpawner(proc: FakeRpcProcess, calls: SpawnCall[]): OmpRpcSpawner {
  return (command, opts): OmpRpcProcess => {
    calls.push({ command, options: opts });
    return proc;
  };
}

/** One realistic assistant turn: text delta, a tool round-trip, then agent_end. */
function assistantTurnFrames(
  options: { text?: string; sessionId?: string } = {}
): Record<string, unknown>[] {
  const text = options.text ?? 'Hello';
  return [
    { type: 'message_start', message: { role: 'assistant', content: [] } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } },
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        usage: { input: 3, output: 2, totalTokens: 5, cost: { total: 0.1 } },
        stopReason: 'stop',
      },
    },
    {
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'README.md' },
    },
    {
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'read',
      result: 'contents',
      isError: false,
    },
    { type: 'agent_end', messages: [], isTerminal: true },
  ];
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

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for test condition.');
}

describe('buildOmpArgs', () => {
  test('builds a safe headless rpc command with no argv prompt', () => {
    const result = buildOmpArgs({
      cwd: '/repo',
      config: { model: 'openai-codex/gpt-6-sol', modelReasoningEffort: 'high' },
      requestOptions: {
        systemPrompt: ['first', 'second'],
        nodeConfig: { skills: ['archon', 'review-*'] },
      },
    });

    expect(result.args).toEqual([
      '--mode',
      'rpc',
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
    ]);
  });

  test('uses request model and string thinking before assistant defaults', () => {
    const result = buildOmpArgs({
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
      cwd: '/repo',
      config: {},
      requestOptions: { nodeConfig: { effort: '  future-omp  ' } },
    });
    expect(result.thinking).toBe('  future-omp  ');
  });

  test('uses resume, fork, and no-session flags without inventing session ids', () => {
    const resumeArgs = buildOmpArgs({
      cwd: '/repo',
      config: {},
      resumeSessionId: 'session-1',
    }).args;
    const resumeIndex = resumeArgs.indexOf('--resume');
    expect(resumeIndex).toBeGreaterThan(-1);
    expect(resumeArgs[resumeIndex + 1]).toBe('session-1');

    const forkArgs = buildOmpArgs({
      cwd: '/repo',
      config: {},
      resumeSessionId: 'session-1',
      requestOptions: { forkSession: true },
    }).args;
    const forkIndex = forkArgs.indexOf('--fork');
    expect(forkIndex).toBeGreaterThan(-1);
    expect(forkArgs[forkIndex + 1]).toBe('session-1');

    expect(
      buildOmpArgs({ cwd: '/repo', config: {}, requestOptions: { persistSession: false } }).args
    ).toContain('--no-session');
  });

  test('rejects resume when persistence is disabled', () => {
    expect(() =>
      buildOmpArgs({
        cwd: '/repo',
        config: {},
        resumeSessionId: 'session-1',
        requestOptions: { persistSession: false },
      })
    ).toThrow('cannot resume');
  });

  test('omits no-extensions only after explicit opt-in', () => {
    const result = buildOmpArgs({ cwd: '/repo', config: { enableExtensions: true } });
    expect(result.args).not.toContain('--no-extensions');
  });
});

describe('OmpProvider fresh-spawn turns', () => {
  test('completes the ready/get_state handshake, streams a turn, emits the concrete result', async () => {
    const proc = makeFakeRpcProcess();
    proc.queueTurn(assistantTurnFrames());
    const calls: SpawnCall[] = [];
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toContain('rpc');
    expect(proc.writes.some(w => w.type === 'get_state')).toBe(true);
    expect(proc.writes.some(w => w.type === 'prompt')).toBe(true);
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
      sessionId: DEFAULT_SESSION_ID,
      tokens: { input: 3, output: 2, total: 5, cost: 0.1 },
      stopReason: 'stop',
      resolvedModel: { id: 'openai-codex/gpt-6-sol' },
    });
  });

  test('marks a successful resumed stream as resumed and passes --resume', async () => {
    const proc = makeFakeRpcProcess({ sessionId: 'new-session' });
    proc.queueTurn(assistantTurnFrames());
    const calls: SpawnCall[] = [];
    const chunks = await collect(
      new OmpProvider({ spawn: makeSpawner(proc, calls) }),
      'old-session'
    );
    expect(calls[0]?.command).toContain('--resume');
    expect(calls[0]?.command).toContain('old-session');
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'new-session',
      resumed: true,
    });
  });

  test('rejects a pre-aborted request without spawning', async () => {
    const calls: SpawnCall[] = [];
    const controller = new AbortController();
    controller.abort();
    const provider = new OmpProvider({ spawn: makeSpawner(makeFakeRpcProcess(), calls) });
    await expect(
      collect(provider, undefined, { abortSignal: controller.signal, env: { OMP_BIN_PATH: '' } })
    ).rejects.toThrow('Query aborted');
    expect(calls).toHaveLength(0);
  });

  test('kills the child and throws when get_state never answers', async () => {
    const proc = makeFakeRpcProcess({ autoAckGetState: false });
    await expect(collect(new OmpProvider({ spawn: makeSpawner(proc, []) }))).rejects.toThrow(
      'OMP RPC frame read timed out'
    );
    expect(proc.signals).toContain('SIGKILL');
  }, 20_000);

  test('maps a rejected prompt request to a protocol error and disposes the session', async () => {
    const proc = makeFakeRpcProcess({ autoAckPrompt: false });
    const iterator = new OmpProvider({ spawn: makeSpawner(proc, []) }).sendQuery(
      'hello',
      '/repo',
      undefined,
      {
        env: { OMP_BIN_PATH: process.execPath },
      }
    );
    const chunks: MessageChunk[] = [];
    const done = (async (): Promise<void> => {
      for await (const chunk of iterator) chunks.push(chunk);
    })();
    await waitFor(() => proc.writes.some(w => w.type === 'prompt'));
    const promptWrite = proc.writes.find(w => w.type === 'prompt');
    proc.push({
      id: promptWrite?.id,
      type: 'response',
      command: 'prompt',
      success: false,
      error: 'nope',
    });
    await done;
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_protocol_error',
    });
  });

  test('maps malformed JSON mid-turn to a protocol error and kills the child', async () => {
    const proc = makeFakeRpcProcess();
    const chunksPromise = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    await waitFor(() => proc.writes.some(w => w.type === 'prompt'));
    proc.pushRaw('{bad json\n');
    const chunks = await chunksPromise;
    expect(proc.signals).toContain('SIGTERM');
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_protocol_error',
    });
  });

  test('maps an rpc_frame_error frame to a protocol error', async () => {
    const proc = makeFakeRpcProcess();
    const chunksPromise = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    await waitFor(() => proc.writes.some(w => w.type === 'prompt'));
    proc.push({ type: 'rpc_frame_error', originalType: 'agent_end', error: 'frame too large' });
    const chunks = await chunksPromise;
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_protocol_error',
    });
  });

  test('auto-answers a defensive extension_ui_request instead of hanging', async () => {
    const proc = makeFakeRpcProcess();
    const chunksPromise = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    await waitFor(() => proc.writes.some(w => w.type === 'prompt'));
    proc.push({ type: 'extension_ui_request', id: 'ext-1', method: 'confirm' });
    for (const frame of assistantTurnFrames()) proc.push(frame);
    const chunks = await chunksPromise;
    expect(proc.writes).toContainEqual({
      type: 'extension_ui_response',
      id: 'ext-1',
      confirmed: true,
    });
    expect(chunks.at(-1)).toMatchObject({ type: 'result', stopReason: 'stop' });
  });

  test('maps an unexpected mid-turn exit to a transport error', async () => {
    const proc = makeFakeRpcProcess();
    const chunksPromise = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    await waitFor(() => proc.writes.some(w => w.type === 'prompt'));
    proc.resolveExit(1);
    await expect(chunksPromise).rejects.toThrow();
  });

  test('preserves parsed usage when the process exits unexpectedly after a terminal turn', async () => {
    const proc = makeFakeRpcProcess({ sessionId: 'usage-session' });
    proc.queueTurn(assistantTurnFrames());
    // Exit right after agent_end, before this call would otherwise keep it warm.
    const chunksPromise = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    await waitFor(() => proc.stdinEnded || proc.signals.length > 0, 2000).catch(() => undefined);
    const chunks = await chunksPromise;
    const results = chunks.filter(c => c.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      sessionId: 'usage-session',
      stopReason: 'stop',
    });
  });

  test('augments JSON-schema prompts and returns parsed structured output', async () => {
    const proc = makeFakeRpcProcess({ sessionId: 'json-session' });
    proc.queueTurn(assistantTurnFrames({ text: '{"answer":"ok"}' }));
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      outputFormat: {
        type: 'json_schema',
        schema: { type: 'object', properties: { answer: { type: 'string' } } },
      },
    });
    const promptWrite = proc.writes.find(w => w.type === 'prompt');
    expect(String(promptWrite?.message)).toContain('CRITICAL: Respond with ONLY a JSON object');
    expect(chunks.at(-1)).toMatchObject({ type: 'result', structuredOutput: { answer: 'ok' } });
  });

  test('warns before spawn for object-form thinking and falls back to effort', async () => {
    const calls: SpawnCall[] = [];
    const proc = makeFakeRpcProcess();
    proc.queueTurn(assistantTurnFrames());
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
});

describe('OmpProvider warm-session reuse', () => {
  afterEach(() => {
    setWarmSessionIdleEvictionMsForTest(TEST_IDLE_EVICTION_MS);
  });

  test('reuses the same live process for a second turn on the same session — no respawn', async () => {
    const proc = makeFakeRpcProcess({ sessionId: 'warm-session' });
    proc.queueTurn(assistantTurnFrames({ text: 'first' }));
    const calls: SpawnCall[] = [];
    const provider = new OmpProvider({ spawn: makeSpawner(proc, calls) });

    const first = await collect(provider);
    expect(first.at(-1)).toMatchObject({ type: 'result', sessionId: 'warm-session' });
    expect(calls).toHaveLength(1);

    proc.queueTurn(assistantTurnFrames({ text: 'second' }));
    const second = await collect(provider, 'warm-session');
    expect(second).toContainEqual({ type: 'assistant', content: 'second' });
    // Still exactly one spawn — the second turn rode the same process.
    expect(calls).toHaveLength(1);
    const promptWrites = proc.writes.filter(w => w.type === 'prompt');
    expect(promptWrites).toHaveLength(2);
  });

  test('does not reuse across a mismatched resumeSessionId — spawns fresh and closes the old one gracefully', async () => {
    const warmProc = makeFakeRpcProcess({ sessionId: 'warm-session' });
    warmProc.queueTurn(assistantTurnFrames());
    const freshProc = makeFakeRpcProcess({ sessionId: 'other-session' });
    freshProc.queueTurn(assistantTurnFrames());
    const calls: SpawnCall[] = [];
    let spawnCount = 0;
    const spawner: OmpRpcSpawner = (command, opts) => {
      spawnCount += 1;
      calls.push({ command, options: opts });
      return spawnCount === 1 ? warmProc : freshProc;
    };
    const provider = new OmpProvider({ spawn: spawner });

    await collect(provider);
    await collect(provider, 'some-other-session-id');

    expect(calls).toHaveLength(2);
    expect(warmProc.stdinEnded).toBe(true);
  });

  test('never reuses when persistSession is false and closes right after the turn', async () => {
    const proc = makeFakeRpcProcess();
    proc.queueTurn(assistantTurnFrames());
    const calls: SpawnCall[] = [];
    const provider = new OmpProvider({ spawn: makeSpawner(proc, calls) });
    await collect(provider, undefined, { persistSession: false });
    await waitFor(() => proc.stdinEnded);
    expect(calls[0]?.command).toContain('--no-session');
  });

  test('always spawns fresh when forkSession is true, even with a matching resumeSessionId', async () => {
    const warmProc = makeFakeRpcProcess({ sessionId: 'warm-session' });
    warmProc.queueTurn(assistantTurnFrames());
    const forkedProc = makeFakeRpcProcess({ sessionId: 'forked-session' });
    forkedProc.queueTurn(assistantTurnFrames());
    let spawnCount = 0;
    const calls: SpawnCall[] = [];
    const spawner: OmpRpcSpawner = (command, opts) => {
      spawnCount += 1;
      calls.push({ command, options: opts });
      return spawnCount === 1 ? warmProc : forkedProc;
    };
    const provider = new OmpProvider({ spawn: spawner });

    await collect(provider);
    const chunks = await collect(provider, 'warm-session', { forkSession: true });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.command).toContain('--fork');
    expect(chunks.at(-1)).toMatchObject({ sessionId: 'forked-session' });
  });

  test('idle-evicts an unused warm session after the configured TTL, closing it gracefully', async () => {
    setWarmSessionIdleEvictionMsForTest(20);
    const proc = makeFakeRpcProcess({ sessionId: 'warm-session' });
    proc.queueTurn(assistantTurnFrames());
    const provider = new OmpProvider({ spawn: makeSpawner(proc, []) });
    await collect(provider);
    await waitFor(() => proc.stdinEnded, 2000);
    expect(proc.signals).not.toContain('SIGTERM');
  });

  test('reusing before the idle TTL elapses cancels the pending eviction', async () => {
    setWarmSessionIdleEvictionMsForTest(200);
    const proc = makeFakeRpcProcess({ sessionId: 'warm-session' });
    proc.queueTurn(assistantTurnFrames({ text: 'first' }));
    const provider = new OmpProvider({ spawn: makeSpawner(proc, []) });
    await collect(provider);

    proc.queueTurn(assistantTurnFrames({ text: 'second' }));
    const second = await collect(provider, 'warm-session');
    expect(second).toContainEqual({ type: 'assistant', content: 'second' });
    expect(proc.stdinEnded).toBe(false);
  });
});

describe('OmpProvider Stop (in-band abort) and Cancel', () => {
  afterEach(() => {
    setTerminationGraceMsForTest(TEST_GRACE_MS);
  });

  test('mid-text Stop sends an in-band abort, never kills the process, yields an interrupted result', async () => {
    const proc = makeFakeRpcProcess({ sessionId: 'stop-session' });
    const interrupt = new AbortController();
    const iterator = new OmpProvider({ spawn: makeSpawner(proc, []) }).sendQuery(
      'hello',
      '/repo',
      undefined,
      {
        env: { OMP_BIN_PATH: process.execPath },
        interruptSignal: interrupt.signal,
      }
    );
    const chunks: MessageChunk[] = [];
    void (async (): Promise<void> => {
      for await (const chunk of iterator) chunks.push(chunk);
    })();

    // Real OMP never emits agent-turn events before it has seen the prompt —
    // wait for the handshake to finish and the prompt to be written before
    // pushing anything, or the ready/get_state handshake drains and discards it.
    await waitFor(() => proc.writes.some(w => w.type === 'prompt'));
    proc.push({ type: 'message_start', message: { role: 'assistant', content: [] } });
    interrupt.abort();
    await waitFor(() => proc.writes.some(w => w.type === 'abort'));
    proc.push({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        provider: 'xai-oauth',
        model: 'grok-4.5',
        usage: { input: 0, output: 0, totalTokens: 0, cost: { total: 0 } },
        stopReason: 'aborted',
        errorMessage: 'Interrupted by user',
      },
    });
    proc.push({ type: 'agent_end', messages: [], isTerminal: true });

    await waitFor(() => chunks.some(c => c.type === 'result'));
    const result = chunks.find(c => c.type === 'result');
    expect(result).toMatchObject({
      type: 'result',
      sessionId: 'stop-session',
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
    });
    expect(proc.signals).toHaveLength(0);
  });

  test('mid-tool Stop maps the interrupted tool call to toolOutcome "interrupted"', async () => {
    const proc = makeFakeRpcProcess({ sessionId: 'stop-tool-session' });
    const interrupt = new AbortController();
    const iterator = new OmpProvider({ spawn: makeSpawner(proc, []) }).sendQuery(
      'hello',
      '/repo',
      undefined,
      {
        env: { OMP_BIN_PATH: process.execPath },
        interruptSignal: interrupt.signal,
      }
    );
    const chunks: MessageChunk[] = [];
    void (async (): Promise<void> => {
      for await (const chunk of iterator) chunks.push(chunk);
    })();

    await waitFor(() => proc.writes.some(w => w.type === 'prompt'));
    proc.push({
      type: 'tool_execution_start',
      toolCallId: 'sleep-1',
      toolName: 'bash',
      args: { command: 'sleep 90' },
    });
    await waitFor(() => chunks.some(c => c.type === 'tool'));
    interrupt.abort();
    await waitFor(() => proc.writes.some(w => w.type === 'abort'));
    proc.push({
      type: 'tool_execution_end',
      toolCallId: 'sleep-1',
      toolName: 'bash',
      result: 'Command aborted',
      isError: true,
    });
    proc.push({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        provider: 'xai-oauth',
        model: 'grok-4.5',
        usage: { input: 0, output: 0, totalTokens: 0, cost: { total: 0 } },
        stopReason: 'aborted',
        errorMessage: 'Interrupted by user',
      },
    });
    proc.push({ type: 'agent_end', messages: [], isTerminal: true });

    await waitFor(() => chunks.some(c => c.type === 'result'));
    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'bash',
      toolOutput: 'Command aborted',
      toolCallId: 'sleep-1',
      toolOutcome: 'interrupted',
      outputState: 'full',
    });
  });

  test('a Stop that races a natural completion is not classified as interrupted', async () => {
    const proc = makeFakeRpcProcess({ sessionId: 'race-session' });
    proc.queueTurn(assistantTurnFrames());
    const interrupt = new AbortController();
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      interruptSignal: interrupt.signal,
    });
    // Interrupt fires only after the turn has already fully streamed.
    interrupt.abort();
    expect(chunks.at(-1)).toMatchObject({ type: 'result', stopReason: 'stop' });
    expect(chunks.at(-1)).not.toHaveProperty('terminalReason');
  });

  test('redirect after Stop reuses the same live process — no respawn', async () => {
    const proc = makeFakeRpcProcess({ sessionId: 'redirect-session' });
    const interrupt = new AbortController();
    const provider = new OmpProvider({ spawn: makeSpawner(proc, []) });
    const iterator = provider.sendQuery('hello', '/repo', undefined, {
      env: { OMP_BIN_PATH: process.execPath },
      interruptSignal: interrupt.signal,
    });
    const chunks: MessageChunk[] = [];
    void (async (): Promise<void> => {
      for await (const chunk of iterator) chunks.push(chunk);
    })();
    await waitFor(() => proc.writes.some(w => w.type === 'prompt'));
    proc.push({ type: 'message_start', message: { role: 'assistant', content: [] } });
    interrupt.abort();
    await waitFor(() => proc.writes.some(w => w.type === 'abort'));
    proc.push({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        provider: 'xai-oauth',
        model: 'grok-4.5',
        usage: { input: 0, output: 0, totalTokens: 0, cost: { total: 0 } },
        stopReason: 'aborted',
      },
    });
    proc.push({ type: 'agent_end', messages: [], isTerminal: true });
    await waitFor(() => chunks.some(c => c.type === 'result'));

    proc.queueTurn(assistantTurnFrames({ text: 'redirected' }));
    const redirectChunks = await collect(provider, 'redirect-session');
    expect(redirectChunks).toContainEqual({ type: 'assistant', content: 'redirected' });
  });

  test('Cancel escalates SIGTERM to SIGKILL and rejects with Query aborted', async () => {
    const proc = makeFakeRpcProcess();
    setTerminationGraceMsForTest(30);
    const controller = new AbortController();
    const calls: SpawnCall[] = [];
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      abortSignal: controller.signal,
    });
    await waitFor(() => calls.length === 1);
    controller.abort();
    await expect(run).rejects.toThrow('Query aborted');
    await waitFor(() => proc.signals.includes('SIGKILL'));
    expect(proc.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  test('Cancel while idling between two turns kills the warm process with no active call', async () => {
    const proc = makeFakeRpcProcess({ sessionId: 'idle-cancel-session' });
    proc.queueTurn(assistantTurnFrames());
    const controller = new AbortController();
    const provider = new OmpProvider({ spawn: makeSpawner(proc, []) });
    await collect(provider, undefined, { abortSignal: controller.signal });

    controller.abort();
    await waitFor(() => proc.signals.includes('SIGTERM'));
    expect(proc.signals[0]).toBe('SIGTERM');
  });
});
