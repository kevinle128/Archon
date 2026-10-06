import { createLogger } from '@archon/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('adapter.web.transport');
  return cachedLog;
}

export interface SSEWriter {
  writeSSE(data: { data: string; event?: string; id?: string }): Promise<void>;
  close(): Promise<void>;
  readonly closed: boolean;
}

/** Grace period (ms) before firing onCleanup after stream removal. */
const RECONNECT_GRACE_MS = 5_000;

/**
 * Max time (ms) to hold buffered events waiting for a stream to connect.
 *
 * Must be ≥ RECONNECT_GRACE_MS — otherwise events emitted during a reconnect
 * window are dropped *before* the client has had a chance to reconnect, which
 * manifests as perpetually-spinning tool cards when a `tool_result` happens to
 * land in the gap. 60s covers typical EventSource auto-reconnect delays on
 * flaky networks (mobile, VPN, laptop sleep) without meaningfully growing
 * memory footprint — events are small JSON strings and the cap below bounds
 * the worst case.
 */
const EVENT_BUFFER_TTL_MS = 60_000;

/** Max events to buffer per conversation before oldest are dropped. */
const EVENT_BUFFER_MAX = 500;

/** Min interval (ms) between `transport.buffer_evicted_oldest` warns per conversation. */
const EVICTION_WARN_THROTTLE_MS = 5_000;

// Fail-fast invariant: buffer TTL must outlive the reconnect grace window,
// otherwise events emitted during a reconnect can be dropped before the
// client has had a chance to come back. See comment on EVENT_BUFFER_TTL_MS.
if (EVENT_BUFFER_TTL_MS < RECONNECT_GRACE_MS) {
  throw new Error(
    `EVENT_BUFFER_TTL_MS (${EVENT_BUFFER_TTL_MS}) must be >= RECONNECT_GRACE_MS (${RECONNECT_GRACE_MS})`
  );
}

interface BufferedEvent {
  data: string;
  timestamp: number;
}

/**
 * Stream id that fans out to every open subscriber instead of the
 * single-writer eviction every other id gets. The dashboard is read by
 * several independent surfaces at once (a run page's terminal-edge probe,
 * the runs list, the standalone dashboard page) and none of them should
 * evict another's connection just by opening its own.
 */
const BROADCAST_STREAM_ID = '__dashboard__';

export class SSETransport {
  private streams = new Map<string, SSEWriter>();
  /** Subscriber sets for {@link BROADCAST_STREAM_ID}-style fan-out ids, keyed apart from `streams`. */
  private broadcastStreams = new Map<string, Set<SSEWriter>>();
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private zombieReaperHandle: ReturnType<typeof setInterval> | null = null;
  private eventBuffer = new Map<string, BufferedEvent[]>();
  private bufferCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastEvictionWarnAt = new Map<string, number>();

  constructor(
    private onCleanup?: (conversationId: string) => void,
    private graceMs: number = RECONNECT_GRACE_MS
  ) {}

  /**
   * Register an SSE stream for a conversation.
   * Closes any existing stream (browser refresh / new tab replaces old).
   * Replays any buffered events that arrived before the stream connected.
   * Exception: {@link BROADCAST_STREAM_ID} never closes an existing stream —
   * see {@link registerBroadcastStream}.
   */
  registerStream(conversationId: string, stream: SSEWriter): void {
    if (conversationId === BROADCAST_STREAM_ID) {
      this.registerBroadcastStream(conversationId, stream);
      return;
    }

    const existing = this.streams.get(conversationId);
    if (existing && !existing.closed) {
      existing.close().catch((e: unknown) => {
        getLog().warn({ conversationId, err: e }, 'sse_write_failed');
      });
    }
    this.streams.set(conversationId, stream);

    // Cancel pending cleanup — client reconnected
    const pendingCleanup = this.cleanupTimers.get(conversationId);
    if (pendingCleanup) {
      clearTimeout(pendingCleanup);
      this.cleanupTimers.delete(conversationId);
    }

    // Replay buffered events that arrived before the stream connected
    this.replayBuffer(conversationId, stream);
  }

  /**
   * Add a subscriber to a broadcast id's fan-out set. Never evicts an
   * existing subscriber — every open connection for this id keeps receiving
   * events, which is the whole point of a broadcast id (see
   * {@link BROADCAST_STREAM_ID}'s doc comment).
   */
  private registerBroadcastStream(id: string, stream: SSEWriter): void {
    let subscribers = this.broadcastStreams.get(id);
    if (!subscribers) {
      subscribers = new Set();
      this.broadcastStreams.set(id, subscribers);
    }
    subscribers.add(stream);

    // Cancel a pending cleanup scheduled when the last subscriber left.
    const pendingCleanup = this.cleanupTimers.get(id);
    if (pendingCleanup) {
      clearTimeout(pendingCleanup);
      this.cleanupTimers.delete(id);
    }

    // A buffer can only exist here if it was empty of subscribers when the
    // event arrived — once at least one subscriber is connected, `emit`/
    // `writeToStream` fan out live instead of buffering. So this replay
    // only ever plays back to the first subscriber to reconnect.
    this.replayBuffer(id, stream);
  }

  /** Shared buffered-event replay, used by both the single-writer and broadcast paths. */
  private replayBuffer(id: string, stream: SSEWriter): void {
    const buffered = this.eventBuffer.get(id);
    if (!buffered || buffered.length === 0) return;
    const now = Date.now();
    const valid = buffered.filter(e => now - e.timestamp < EVENT_BUFFER_TTL_MS);
    const expired = buffered.length - valid.length;
    this.clearBuffer(id);
    if (expired > 0) {
      // Events outlived the buffer TTL before the client reconnected.
      // Symptom on the UI: stuck tool cards for any tool_result that was
      // in the expired batch. If this fires in practice, bump TTL further.
      getLog().warn(
        { conversationId: id, expired, ttlMs: EVENT_BUFFER_TTL_MS },
        'transport.buffer_ttl_expired'
      );
    }
    if (valid.length > 0) {
      getLog().debug({ conversationId: id, count: valid.length }, 'sse_buffer_replay');
      for (const event of valid) {
        if (stream.closed) break;
        stream.writeSSE({ data: event.data }).catch((e: unknown) => {
          getLog().warn({ conversationId: id, err: e }, 'sse_buffer_replay_failed');
        });
      }
    }
  }

  removeStream(conversationId: string, expectedStream?: SSEWriter): void {
    if (conversationId === BROADCAST_STREAM_ID) {
      this.removeBroadcastStream(conversationId, expectedStream);
      return;
    }

    // If a specific stream reference is provided, only remove if it matches
    // the currently registered stream. This prevents a race condition where
    // a stale onAbort callback (from a replaced stream) removes a newer stream.
    // Critical in React StrictMode which double-mounts components, causing
    // rapid connect → disconnect → reconnect cycles.
    if (expectedStream) {
      const current = this.streams.get(conversationId);
      if (current !== expectedStream) return;
    }
    this.streams.delete(conversationId);
    // Schedule onCleanup after grace period (allows reconnection without losing persistence state)
    this.scheduleCleanup(conversationId, this.graceMs);
  }

  /**
   * Remove one subscriber from a broadcast id's fan-out set. Every real
   * caller passes `expectedStream` (each subscriber's own `onAbort` removes
   * only itself); the no-argument form is a defensive fallback that clears
   * every subscriber, mirroring the single-writer path's unconditional
   * delete when no reference is given.
   */
  private removeBroadcastStream(id: string, expectedStream?: SSEWriter): void {
    const subscribers = this.broadcastStreams.get(id);
    if (!subscribers) return;
    if (expectedStream) {
      if (!subscribers.has(expectedStream)) return;
      subscribers.delete(expectedStream);
    } else {
      subscribers.clear();
    }
    if (subscribers.size === 0) {
      this.broadcastStreams.delete(id);
      // Schedule onCleanup after grace period, same as the single-writer path.
      this.scheduleCleanup(id, this.graceMs);
    }
  }

  hasActiveStream(conversationId: string): boolean {
    if (conversationId === BROADCAST_STREAM_ID) {
      const subscribers = this.broadcastStreams.get(conversationId);
      if (!subscribers) return false;
      for (const stream of subscribers) {
        if (!stream.closed) return true;
      }
      return false;
    }
    const stream = this.streams.get(conversationId);
    return stream !== undefined && !stream.closed;
  }

  start(): void {
    // Reap zombie streams every 5 minutes
    this.zombieReaperHandle = setInterval(() => {
      for (const [id, stream] of this.streams) {
        if (stream.closed) {
          this.removeStream(id);
        }
      }
      for (const [id, subscribers] of this.broadcastStreams) {
        for (const stream of [...subscribers]) {
          if (stream.closed) {
            this.removeBroadcastStream(id, stream);
          }
        }
      }
    }, 300_000);

    getLog().info('web.adapter_ready');
  }

  stop(): void {
    // Stop zombie stream reaper
    if (this.zombieReaperHandle) {
      clearInterval(this.zombieReaperHandle);
      this.zombieReaperHandle = null;
    }

    for (const [id, stream] of this.streams) {
      if (!stream.closed) {
        stream.close().catch((e: unknown) => {
          getLog().warn({ conversationId: id, err: e }, 'sse_close_failed');
        });
      }
      getLog().debug({ conversationId: id }, 'sse_stream_closed');
    }
    this.streams.clear();
    for (const [id, subscribers] of this.broadcastStreams) {
      for (const stream of subscribers) {
        if (!stream.closed) {
          stream.close().catch((e: unknown) => {
            getLog().warn({ conversationId: id, err: e }, 'sse_close_failed');
          });
        }
      }
      getLog().debug({ conversationId: id, subscribers: subscribers.size }, 'sse_stream_closed');
    }
    this.broadcastStreams.clear();
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.eventBuffer.clear();
    this.lastEvictionWarnAt.clear();
    for (const timer of this.bufferCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.bufferCleanupTimers.clear();
    getLog().info('web.adapter_stopped');
  }

  async emit(conversationId: string, event: string): Promise<void> {
    if (conversationId === BROADCAST_STREAM_ID) {
      await this.emitBroadcast(conversationId, event);
      return;
    }
    const stream = this.streams.get(conversationId);
    if (stream && !stream.closed) {
      try {
        await stream.writeSSE({ data: event });
      } catch (e: unknown) {
        getLog().warn({ conversationId, err: e }, 'sse_write_failed');
        // Remove and close the stream so the browser's EventSource detects
        // the disconnect and auto-reconnects with a fresh connection.
        this.streams.delete(conversationId);
        stream.close().catch((_: unknown) => {
          /* stream already closing */
        });
      }
    } else if (stream?.closed) {
      this.streams.delete(conversationId);
      this.bufferEvent(conversationId, event);
    } else {
      this.bufferEvent(conversationId, event);
    }
  }

  /** Fan out an event to every open subscriber of a broadcast id; buffers only while none are open. */
  private async emitBroadcast(id: string, event: string): Promise<void> {
    const subscribers = this.activeBroadcastSubscribers(id);
    if (subscribers.length === 0) {
      this.bufferEvent(id, event);
      return;
    }
    await Promise.all(
      subscribers.map(async stream => {
        try {
          await stream.writeSSE({ data: event });
        } catch (e: unknown) {
          getLog().warn({ conversationId: id, err: e }, 'sse_write_failed');
          this.removeBroadcastStream(id, stream);
          stream.close().catch((_: unknown) => {
            /* stream already closing */
          });
        }
      })
    );
  }

  /**
   * Emit a workflow event to the SSE stream for a conversation. Fire-and-forget.
   */
  emitWorkflowEvent(conversationId: string, event: string): void {
    this.writeToStream(conversationId, event);
  }

  /**
   * Write an event to the stream if one exists, no-op otherwise.
   * Used by emitWorkflowEvent and any other fire-and-forget path.
   */
  private writeToStream(conversationId: string, event: string): void {
    if (conversationId === BROADCAST_STREAM_ID) {
      this.writeToBroadcastStream(conversationId, event);
      return;
    }
    const stream = this.streams.get(conversationId);
    if (stream && !stream.closed) {
      stream.writeSSE({ data: event }).catch((e: unknown) => {
        getLog().warn({ conversationId, err: e }, 'sse_write_failed');
        this.streams.delete(conversationId);
        stream.close().catch((_: unknown) => {
          /* stream already closing */
        });
      });
    } else {
      this.bufferEvent(conversationId, event);
    }
  }

  /** Fire-and-forget counterpart of {@link emitBroadcast}, used by `writeToStream`. */
  private writeToBroadcastStream(id: string, event: string): void {
    const subscribers = this.activeBroadcastSubscribers(id);
    if (subscribers.length === 0) {
      this.bufferEvent(id, event);
      return;
    }
    for (const stream of subscribers) {
      stream.writeSSE({ data: event }).catch((e: unknown) => {
        getLog().warn({ conversationId: id, err: e }, 'sse_write_failed');
        this.removeBroadcastStream(id, stream);
        stream.close().catch((_: unknown) => {
          /* stream already closing */
        });
      });
    }
  }

  /** Snapshot of a broadcast id's currently-open subscribers, safe to iterate while mutating the underlying set. */
  private activeBroadcastSubscribers(id: string): SSEWriter[] {
    const subscribers = this.broadcastStreams.get(id);
    if (!subscribers) return [];
    return [...subscribers].filter(stream => !stream.closed);
  }

  /**
   * Buffer an event for later replay when a stream connects.
   * Events expire after EVENT_BUFFER_TTL_MS and are capped at EVENT_BUFFER_MAX per conversation.
   */
  private bufferEvent(conversationId: string, data: string): void {
    let buf = this.eventBuffer.get(conversationId);
    if (!buf) {
      buf = [];
      this.eventBuffer.set(conversationId, buf);
    }
    buf.push({ data, timestamp: Date.now() });
    // Cap buffer size — drop oldest if over limit. Warn so we notice if
    // this ever happens in practice: evicted events mean the UI will miss
    // something when the client reconnects.
    if (buf.length > EVENT_BUFFER_MAX) {
      buf.shift();
      // Throttle: a runaway producer could overflow by hundreds in a tight
      // loop and flood logs. Warn at most once per EVICTION_WARN_THROTTLE_MS
      // per conversation — enough to notice in practice without flooding.
      const lastWarn = this.lastEvictionWarnAt.get(conversationId) ?? 0;
      const now = Date.now();
      if (now - lastWarn >= EVICTION_WARN_THROTTLE_MS) {
        this.lastEvictionWarnAt.set(conversationId, now);
        getLog().warn(
          { conversationId, bufferMax: EVENT_BUFFER_MAX },
          'transport.buffer_evicted_oldest'
        );
      }
    }
    // Schedule auto-cleanup so buffers don't leak for conversations that never
    // connect. Reset the timer on each new event so the buffer is held for
    // TTL past the *most recent* event, not the first one.
    const existingCleanup = this.bufferCleanupTimers.get(conversationId);
    if (existingCleanup) clearTimeout(existingCleanup);
    const timer = setTimeout(() => {
      this.clearBuffer(conversationId);
    }, EVENT_BUFFER_TTL_MS + 500);
    this.bufferCleanupTimers.set(conversationId, timer);
    getLog().debug({ conversationId, buffered: buf.length }, 'sse_event_buffered');
  }

  private clearBuffer(conversationId: string): void {
    this.eventBuffer.delete(conversationId);
    this.lastEvictionWarnAt.delete(conversationId);
    const timer = this.bufferCleanupTimers.get(conversationId);
    if (timer) {
      clearTimeout(timer);
      this.bufferCleanupTimers.delete(conversationId);
    }
  }

  /**
   * Schedule onCleanup callback after a delay.
   * If the client reconnects before the timer fires, the cleanup is cancelled.
   */
  private scheduleCleanup(conversationId: string, delayMs: number): void {
    // Cancel any existing timer for this conversation
    const existing = this.cleanupTimers.get(conversationId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      try {
        this.cleanupTimers.delete(conversationId);
        // Only clean up if the resource is still absent (client didn't
        // reconnect) — checked against whichever map actually holds this id.
        const stillAbsent =
          conversationId === BROADCAST_STREAM_ID
            ? !this.broadcastStreams.has(conversationId)
            : !this.streams.has(conversationId);
        if (stillAbsent && this.onCleanup) {
          this.onCleanup(conversationId);
        }
      } catch (e: unknown) {
        getLog().warn({ conversationId, err: e }, 'cleanup_timer_failed');
      }
    }, delayMs);

    this.cleanupTimers.set(conversationId, timer);
  }
}
