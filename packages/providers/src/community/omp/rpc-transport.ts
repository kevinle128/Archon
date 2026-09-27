/**
 * Wire-level primitives for OMP's `--mode rpc` protocol: a persistent JSONL
 * envelope over stdio, distinct from the `--mode json` single-shot argv
 * transport `buildOmpArgs`/`OmpProvider` used before this module existed.
 * `OmpProvider` (provider.ts) owns turn orchestration, session reuse, and
 * result classification; this module owns spawning the child, framing its
 * stdout into `RpcFrame`s, and writing frames to its stdin.
 *
 * Protocol v1 only. OMP advertises `supportedProtocolVersions: [1, 2]` on its
 * `ready` frame but stays on v1 until a client sends `negotiate_protocol` —
 * this reader never does, so every frame stays v1-encoded. v1's writer-side
 * shrink passes can silently truncate a frame once it exceeds 1 MiB
 * (stripping array/object entries and capping string length before falling
 * back to `rpc_frame_error`/`overflowFrame`). Archon reads only a handful of
 * small top-level fields per frame (`type`, `delta`, `stopReason`,
 * `toolCallId`, …), so the practical exposure is a very long final assistant
 * message losing trailing text — already surfaced (not silently) by the
 * existing `omp_stream_mismatch` completeness check in `event-parser.ts`.
 * Negotiating v2 would add a chunk-reassembly codec for a truncation mode
 * this codebase already detects and reports; not built.
 */

/** One parsed `--mode rpc` JSONL frame. Field shapes vary by `type`. */
export interface RpcFrame {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** A malformed frame on the wire — distinct from a stream I/O failure so callers can classify it as a protocol error. */
export class RpcFrameParseError extends Error {}

function isRpcFrame(value: unknown): value is RpcFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.length > 0
  );
}

/**
 * Line-delimited JSON reader over an OMP `--mode rpc` child's stdout.
 *
 * Frames are queued as they arrive; `next()` either drains the queue or
 * waits for the next `feed()`. Once `fail()` is called (stdout ended or
 * errored), every queued-but-unread frame is discarded, every pending and
 * future `next()` rejects with the recorded error — a reader that has ended
 * never silently resolves with stale data.
 */
export class RpcFrameReader {
  private buffer = '';
  private readonly pending: RpcFrame[] = [];
  private waiters: {
    resolve: (frame: RpcFrame) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | undefined;
  }[] = [];
  private endError: Error | undefined;
  private ended = false;

  /** Feed a raw stdout chunk. Malformed JSON or a non-object frame calls `fail()`. */
  feed(chunk: string): void {
    if (this.ended) return;
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          this.fail(
            new RpcFrameParseError(`OMP RPC CLI emitted invalid JSON: ${line.slice(0, 1000)}`)
          );
          return;
        }
        if (!isRpcFrame(parsed)) {
          this.fail(
            new RpcFrameParseError('OMP RPC CLI emitted a record without a non-empty string type.')
          );
          return;
        }
        this.deliver(parsed);
      }
      if (this.ended) return;
      index = this.buffer.indexOf('\n');
    }
  }

  /** Marks the stream ended (stdout closed/errored). Idempotent — first call wins. */
  fail(error: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.endError = error;
    this.pending.length = 0;
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private deliver(frame: RpcFrame): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(frame);
      return;
    }
    this.pending.push(frame);
  }

  /**
   * Resolves with the next frame. Waits indefinitely when `timeoutMs` is
   * omitted (production drain loop — the workflow engine's own idle timeout
   * and Cancel/abort govern how long a caller actually waits); rejects after
   * `timeoutMs` when given (used only for the bounded ready/get_state
   * handshake and in tests).
   */
  async next(timeoutMs?: number): Promise<RpcFrame> {
    const queued = this.pending.shift();
    if (queued !== undefined) return queued;
    if (this.ended) throw this.endError ?? new Error('OMP RPC stream ended.');
    return new Promise<RpcFrame>((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.waiters = this.waiters.filter(w => w.resolve !== resolve);
              reject(new Error('OMP RPC frame read timed out.'));
            }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }
}

/** Minimal process shape `OmpProvider` drives — bidirectional, unlike the old argv-only `OmpProcess`. */
export interface OmpRpcProcess {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
  write(data: string): void;
  /** Half-closes stdin — OMP's `--mode rpc` exits only on stdin EOF (clean shutdown). */
  endStdin(): void;
  kill(signal?: NodeJS.Signals): void;
}

export interface OmpRpcSpawnOptions {
  cwd: string;
  env: Record<string, string>;
}

export type OmpRpcSpawner = (command: string[], options: OmpRpcSpawnOptions) => OmpRpcProcess;

export function defaultRpcSpawner(command: string[], options: OmpRpcSpawnOptions): OmpRpcProcess {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    pid: proc.pid,
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited,
    write: (data): void => {
      proc.stdin.write(data);
      proc.stdin.flush();
    },
    endStdin: (): void => {
      void proc.stdin.end();
    },
    kill: (signal?: NodeJS.Signals): void => {
      proc.kill(signal);
    },
  };
}

async function pumpStdoutInto(
  stdout: ReadableStream<Uint8Array> | null,
  reader: RpcFrameReader
): Promise<void> {
  if (!stdout) {
    reader.fail(new Error('OMP RPC CLI produced no stdout stream.'));
    return;
  }
  // `.getReader()` + manual `read()` loop rather than `for await` directly on
  // the stream — portable across every tsconfig this monorepo type-checks
  // with, some of which lack `ReadableStream[Symbol.asyncIterator]` in `lib`.
  const streamReader = stdout.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const next = await streamReader.read();
      if (next.done) break;
      reader.feed(decoder.decode(next.value, { stream: true }));
    }
    reader.fail(new Error('OMP RPC CLI closed stdout.'));
  } catch (error: unknown) {
    reader.fail(error instanceof Error ? error : new Error(String(error)));
  } finally {
    streamReader.releaseLock();
  }
}

const MAX_STDERR_CAPTURE_CHARS = 1_000_000;

/** Continuously captures stderr across the whole warm session, capped like the old single-turn capture. */
class StderrCapture {
  private text = '';
  private failure: Error | undefined;

  constructor(stream: ReadableStream<Uint8Array> | null) {
    void this.pump(stream);
  }

  private async pump(stream: ReadableStream<Uint8Array> | null): Promise<void> {
    if (!stream) return;
    const streamReader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const next = await streamReader.read();
        if (next.done) break;
        if (this.text.length < MAX_STDERR_CAPTURE_CHARS) {
          this.text += decoder
            .decode(next.value, { stream: true })
            .slice(0, MAX_STDERR_CAPTURE_CHARS - this.text.length);
        }
      }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error : new Error(String(error));
    } finally {
      streamReader.releaseLock();
    }
  }

  /** Best-effort snapshot for diagnostics — never throws. */
  snapshot(): string {
    return this.text;
  }

  readFailure(): Error | undefined {
    return this.failure;
  }
}

/**
 * One live `--mode rpc` child process plus its frame reader, reusable across
 * multiple `OmpProvider.sendQuery()` calls that target the same OMP session.
 * `OmpProvider` decides reuse-vs-fresh-spawn and result classification;
 * this class only owns the process handle and framing.
 */
export class OmpRpcSession {
  readonly proc: OmpRpcProcess;
  readonly reader: RpcFrameReader;
  private readonly stderrCapture: StderrCapture;
  /** The OMP session id this process is running, once known (via `get_state`). Never reassigned. */
  sessionId: string | undefined;
  lastUsedAt: number;
  private disposedFlag = false;

  constructor(proc: OmpRpcProcess) {
    this.proc = proc;
    this.reader = new RpcFrameReader();
    this.stderrCapture = new StderrCapture(proc.stderr);
    this.lastUsedAt = Date.now();
    void pumpStdoutInto(proc.stdout, this.reader);
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  touch(): void {
    this.lastUsedAt = Date.now();
  }

  writeFrame(frame: Record<string, unknown>): void {
    this.proc.write(`${JSON.stringify(frame)}\n`);
  }

  stderrSnapshot(): string {
    return this.stderrCapture.snapshot();
  }

  stderrFailure(): Error | undefined {
    return this.stderrCapture.readFailure();
  }

  /**
   * Races the next frame against the process's own unexpected exit — a
   * healthy warm session never resolves the exit side while idling between
   * turns, so this only settles early when the child actually died. Wrapped
   * (rather than a bare `{ exitCode }` union member) so the two outcomes
   * stay structurally disjoint from `RpcFrame`'s index signature, which
   * would otherwise defeat a plain `'exitCode' in next` narrowing check.
   */
  async nextFrameOrExit(timeoutMs?: number): Promise<{ frame: RpcFrame } | { exited: number }> {
    return Promise.race([
      this.reader.next(timeoutMs).then((frame): { frame: RpcFrame } => ({ frame })),
      this.proc.exited.then((exited): { exited: number } => ({ exited })),
    ]);
  }

  /**
   * Graceful shutdown: half-close stdin (OMP's documented clean-exit path,
   * proven to keep the session disk-resumable) and wait up to `graceMs`
   * before escalating to SIGKILL. Always marks the session disposed.
   */
  async closeGracefully(graceMs: number): Promise<void> {
    if (this.disposedFlag) return;
    this.disposedFlag = true;
    try {
      this.proc.endStdin();
    } catch {
      // Already closed/exited — fall through to the exit race below.
    }
    const exited = await Promise.race([
      this.proc.exited.then(() => true as const),
      new Promise<false>(resolve => {
        setTimeout(() => {
          resolve(false);
        }, graceMs);
      }),
    ]);
    if (!exited) {
      this.proc.kill('SIGKILL');
      await this.proc.exited.catch(() => undefined);
    }
  }

  /** Hard kill (operator Cancel) — no attempt at a clean, resumable exit. */
  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    this.disposedFlag = true;
    this.proc.kill(signal);
  }
}

export async function spawnOmpRpcSession(
  spawn: OmpRpcSpawner,
  command: string[],
  options: OmpRpcSpawnOptions
): Promise<OmpRpcSession> {
  const proc = spawn(command, options);
  return new OmpRpcSession(proc);
}

/**
 * `--no-extensions` is always passed when spawning, so no extension should
 * ever ask for UI — but an unanswered blocking dialog would hang the whole
 * turn indefinitely (the doc's own default-on-timeout is up to 30s per
 * request), so this defensive auto-answer costs a few lines to avoid an
 * unbounded hang if that assumption is ever wrong. `confirm` mirrors
 * `--yolo`'s auto-approve intent; anything else declines, matching the
 * protocol's own documented default-on-timeout shape.
 */
function isExtensionUiRequest(frame: RpcFrame): frame is RpcFrame & { id: string; method: string } {
  return frame.type === 'extension_ui_request' && typeof frame.id === 'string';
}

function buildExtensionUiAutoAnswer(frame: RpcFrame & { id: string }): Record<string, unknown> {
  return frame.method === 'confirm'
    ? { type: 'extension_ui_response', id: frame.id, confirmed: true }
    : { type: 'extension_ui_response', id: frame.id, cancelled: true };
}

/** A frame OMP substitutes for one it could not encode within the RPC size ceiling (protocol v1). */
function isRpcFrameError(
  frame: RpcFrame
): frame is RpcFrame & { originalType?: string; error?: string } {
  return frame.type === 'rpc_frame_error';
}

export class OmpRpcProtocolError extends Error {}

/**
 * Handles a frame that arrived outside an active turn's own drain loop
 * (during the ready/get_state handshake, or a maintenance frame between
 * turns): auto-answers an extension dialog, throws on a frame the writer
 * could not encode, and otherwise no-ops. Never touches `parser` state.
 */
function handleOutOfBandFrame(session: OmpRpcSession, frame: RpcFrame): void {
  if (isExtensionUiRequest(frame)) {
    session.writeFrame(buildExtensionUiAutoAnswer(frame));
    return;
  }
  if (isRpcFrameError(frame)) {
    throw new OmpRpcProtocolError(
      `OMP CLI could not encode an RPC frame (originalType: ${String(frame.originalType)}): ${String(frame.error)}`
    );
  }
}

const GET_STATE_ID = 'archon-get-state';

/**
 * Consumes the child's first frame (must be `ready`), then requests and
 * returns its OMP session id via `get_state` — `--mode rpc` never emits the
 * `session` header frame that `--mode json` does, so this is the only way
 * to learn the session id for a freshly spawned process.
 */
export async function performReadyHandshakeAndGetSessionId(
  session: OmpRpcSession,
  readyTimeoutMs: number,
  getStateTimeoutMs: number
): Promise<string> {
  const ready = await session.reader.next(readyTimeoutMs);
  if (ready.type !== 'ready') {
    throw new OmpRpcProtocolError(`OMP RPC CLI's first frame was '${ready.type}', not 'ready'.`);
  }
  session.writeFrame({ id: GET_STATE_ID, type: 'get_state' });
  const deadline = Date.now() + getStateTimeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new OmpRpcProtocolError('OMP RPC CLI never answered get_state.');
    const frame = await session.reader.next(remaining);
    if (frame.type === 'response' && frame.id === GET_STATE_ID) {
      if (frame.success !== true) {
        throw new OmpRpcProtocolError(
          `OMP RPC CLI's get_state failed: ${String((frame as { error?: unknown }).error)}`
        );
      }
      const data = (frame as { data?: unknown }).data;
      const sessionId =
        typeof data === 'object' && data !== null
          ? (data as { sessionId?: unknown }).sessionId
          : undefined;
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new OmpRpcProtocolError('OMP RPC CLI get_state response carried no session id.');
      }
      return sessionId;
    }
    handleOutOfBandFrame(session, frame);
  }
}

export { handleOutOfBandFrame };
