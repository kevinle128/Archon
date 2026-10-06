import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock logger before importing transport
const mockLogger = {
  fatal: mock(() => undefined),
  error: mock(() => undefined),
  warn: mock(() => undefined),
  info: mock(() => undefined),
  debug: mock(() => undefined),
  trace: mock(() => undefined),
  child: mock(function (this: unknown) {
    return this;
  }),
  bindings: mock(() => ({ module: 'test' })),
  isLevelEnabled: mock(() => true),
  level: 'info',
};

mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

import { SSETransport, type SSEWriter } from './transport';

function createMockStream(overrides?: Partial<SSEWriter>): SSEWriter {
  return {
    writeSSE: mock(() => Promise.resolve()),
    close: mock(() => Promise.resolve()),
    closed: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockLogger.warn.mockClear();
  mockLogger.info.mockClear();
  mockLogger.debug.mockClear();
});

describe('SSETransport', () => {
  describe('registerStream', () => {
    test('registers a stream for a conversation', () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);

      expect(transport.hasActiveStream('conv-1')).toBe(true);
    });

    test('closes existing stream when registering a new one', () => {
      const transport = new SSETransport();
      const oldStream = createMockStream();
      const newStream = createMockStream();

      transport.registerStream('conv-1', oldStream);
      transport.registerStream('conv-1', newStream);

      expect(oldStream.close).toHaveBeenCalledTimes(1);
      expect(transport.hasActiveStream('conv-1')).toBe(true);
    });

    test('a dashboard-stream subscriber and a per-conversation subscriber on the same run never evict each other', () => {
      // The Legacy terminal-edge kick (`useRunTerminalEdge`) subscribes to
      // `__dashboard__`; Console's own room subscribes to the run's actual
      // conversation id via `useRunStreamSSE`. Both can be live at once for
      // the same run (the visual QA harness's two-shell setup) — they must
      // land in distinct map slots, never contend for one.
      const transport = new SSETransport();
      const dashboardStream = createMockStream();
      const conversationStream = createMockStream();

      transport.registerStream('__dashboard__', dashboardStream);
      transport.registerStream('run-conv-1', conversationStream);

      expect(transport.hasActiveStream('__dashboard__')).toBe(true);
      expect(transport.hasActiveStream('run-conv-1')).toBe(true);
      expect(dashboardStream.close).not.toHaveBeenCalled();
      expect(conversationStream.close).not.toHaveBeenCalled();

      // Order independence: registering the conversation stream first, then
      // the dashboard stream, must not evict either either.
      const transport2 = new SSETransport();
      const conversationStream2 = createMockStream();
      const dashboardStream2 = createMockStream();
      transport2.registerStream('run-conv-2', conversationStream2);
      transport2.registerStream('__dashboard__', dashboardStream2);

      expect(transport2.hasActiveStream('run-conv-2')).toBe(true);
      expect(transport2.hasActiveStream('__dashboard__')).toBe(true);
      expect(conversationStream2.close).not.toHaveBeenCalled();
      expect(dashboardStream2.close).not.toHaveBeenCalled();
    });

    test('a second Legacy run tab, the Console runs page, and the Legacy dashboard page can all subscribe at once', async () => {
      // The three real dashboard surfaces named in the decision this fixes:
      // a run page's own terminal-edge probe, the Console runs list, and the
      // standalone Legacy dashboard page. Each opens an independent
      // `__dashboard__` connection; none may evict any other.
      const transport = new SSETransport();
      const legacyRunTabTwo = createMockStream();
      const consoleRunsPage = createMockStream();
      const legacyDashboardPage = createMockStream();

      transport.registerStream('__dashboard__', legacyRunTabTwo);
      transport.registerStream('__dashboard__', consoleRunsPage);
      transport.registerStream('__dashboard__', legacyDashboardPage);

      expect(legacyRunTabTwo.close).not.toHaveBeenCalled();
      expect(consoleRunsPage.close).not.toHaveBeenCalled();
      expect(legacyDashboardPage.close).not.toHaveBeenCalled();

      await transport.emit('__dashboard__', '{"type":"dag_node"}');

      expect(legacyRunTabTwo.writeSSE).toHaveBeenCalledWith({ data: '{"type":"dag_node"}' });
      expect(consoleRunsPage.writeSSE).toHaveBeenCalledWith({ data: '{"type":"dag_node"}' });
      expect(legacyDashboardPage.writeSSE).toHaveBeenCalledWith({ data: '{"type":"dag_node"}' });
    });

    test('two dashboard subscribers both stay connected and both receive every event', async () => {
      // `__dashboard__` is a broadcast channel: a run page's terminal-edge
      // probe, the runs list, and the standalone dashboard page can all be
      // open on it at once, and none should evict another's connection.
      const transport = new SSETransport();
      const first = createMockStream();
      const second = createMockStream();

      transport.registerStream('__dashboard__', first);
      transport.registerStream('__dashboard__', second);

      expect(first.close).not.toHaveBeenCalled();
      expect(second.close).not.toHaveBeenCalled();
      expect(transport.hasActiveStream('__dashboard__')).toBe(true);

      transport.emitWorkflowEvent('__dashboard__', '{"type":"dag_node"}');
      await transport.emit('__dashboard__', '{"type":"workflow_status"}');

      expect(first.writeSSE).toHaveBeenCalledWith({ data: '{"type":"dag_node"}' });
      expect(second.writeSSE).toHaveBeenCalledWith({ data: '{"type":"dag_node"}' });
      expect(first.writeSSE).toHaveBeenCalledWith({ data: '{"type":"workflow_status"}' });
      expect(second.writeSSE).toHaveBeenCalledWith({ data: '{"type":"workflow_status"}' });
    });

    test('closing one dashboard subscriber leaves the other receiving events', async () => {
      const transport = new SSETransport();
      const first = createMockStream();
      const second = createMockStream();

      transport.registerStream('__dashboard__', first);
      transport.registerStream('__dashboard__', second);
      transport.removeStream('__dashboard__', first);

      expect(second.close).not.toHaveBeenCalled();
      expect(transport.hasActiveStream('__dashboard__')).toBe(true);

      await transport.emit('__dashboard__', '{"type":"dag_node"}');

      expect(second.writeSSE).toHaveBeenCalledWith({ data: '{"type":"dag_node"}' });
      // The removed subscriber never receives anything emitted afterward.
      expect(first.writeSSE).not.toHaveBeenCalled();
    });

    test('a write failure on one dashboard subscriber removes only that subscriber', async () => {
      const transport = new SSETransport();
      const failing = createMockStream({
        writeSSE: mock(() => Promise.reject(new Error('write failed'))),
      });
      const healthy = createMockStream();

      transport.registerStream('__dashboard__', failing);
      transport.registerStream('__dashboard__', healthy);

      await transport.emit('__dashboard__', '{"type":"dag_node"}');

      expect(healthy.writeSSE).toHaveBeenCalledWith({ data: '{"type":"dag_node"}' });
      expect(failing.close).toHaveBeenCalledTimes(1);
      expect(transport.hasActiveStream('__dashboard__')).toBe(true);

      // The healthy subscriber alone still counts as "active" going forward.
      await transport.emit('__dashboard__', '{"type":"workflow_status"}');
      expect(healthy.writeSSE).toHaveBeenCalledWith({ data: '{"type":"workflow_status"}' });
    });

    test('dashboard fan-out buffers only while every subscriber is gone, then replays to the reconnecting one', async () => {
      const transport = new SSETransport();
      const first = createMockStream();

      transport.registerStream('__dashboard__', first);
      transport.removeStream('__dashboard__', first);
      expect(transport.hasActiveStream('__dashboard__')).toBe(false);

      // No subscriber is open — this must buffer, not throw or drop silently.
      await transport.emit('__dashboard__', '{"type":"dag_node"}');

      const reconnected = createMockStream();
      transport.registerStream('__dashboard__', reconnected);

      expect(reconnected.writeSSE).toHaveBeenCalledWith({ data: '{"type":"dag_node"}' });
    });

    test('per-conversation eviction is unchanged by the dashboard broadcast path', () => {
      // Every id other than `__dashboard__` keeps today's single-writer
      // eviction exactly as before — only the broadcast id's behavior changed.
      const transport = new SSETransport();
      const oldStream = createMockStream();
      const newStream = createMockStream();

      transport.registerStream('conv-1', oldStream);
      transport.registerStream('conv-1', newStream);

      expect(oldStream.close).toHaveBeenCalledTimes(1);
      expect(transport.hasActiveStream('conv-1')).toBe(true);

      // A dashboard subscriber alongside it is unaffected in either direction.
      const dashboardStream = createMockStream();
      transport.registerStream('__dashboard__', dashboardStream);
      expect(newStream.close).not.toHaveBeenCalled();
      expect(dashboardStream.close).not.toHaveBeenCalled();
    });

    test('does not close existing stream if already closed', () => {
      const transport = new SSETransport();
      const oldStream = createMockStream({ closed: true });
      const newStream = createMockStream();

      transport.registerStream('conv-1', oldStream);
      transport.registerStream('conv-1', newStream);

      expect(oldStream.close).not.toHaveBeenCalled();
    });

    test('cancels pending cleanup timer on reconnection', () => {
      const cleanup = mock((_id: string) => undefined);
      const transport = new SSETransport(cleanup, 1);
      const stream1 = createMockStream();
      const stream2 = createMockStream();

      transport.registerStream('conv-1', stream1);
      transport.removeStream('conv-1');

      // Re-register before grace period expires — cleanup should be cancelled
      transport.registerStream('conv-1', stream2);

      // Wait longer than the grace period
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(cleanup).not.toHaveBeenCalled();
          resolve();
        }, 50);
      });
    }, 1_000);
  });

  describe('removeStream', () => {
    test('removes a stream', () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);
      transport.removeStream('conv-1');

      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });

    test('only removes if expectedStream matches current stream', () => {
      const transport = new SSETransport();
      const stream1 = createMockStream();
      const stream2 = createMockStream();

      transport.registerStream('conv-1', stream1);
      transport.registerStream('conv-1', stream2);

      // Attempt to remove with stale stream reference — should be no-op
      transport.removeStream('conv-1', stream1);

      expect(transport.hasActiveStream('conv-1')).toBe(true);
    });

    test('removes when expectedStream matches', () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);
      transport.removeStream('conv-1', stream);

      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });

    test('calls onCleanup after grace period if stream not re-registered', () => {
      const cleanup = mock((_id: string) => undefined);
      const transport = new SSETransport(cleanup, 1);
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);
      transport.removeStream('conv-1');

      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(cleanup).toHaveBeenCalledWith('conv-1');
          resolve();
        }, 50);
      });
    }, 1_000);
  });

  describe('emit', () => {
    test('writes to active stream', async () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);
      await transport.emit('conv-1', '{"type":"text"}');

      expect(stream.writeSSE).toHaveBeenCalledWith({ data: '{"type":"text"}' });
    });

    test('no-ops when no stream exists (no buffering)', async () => {
      const transport = new SSETransport();

      // Should not throw
      await transport.emit('conv-1', '{"type":"text"}');
    });

    test('no-ops when stream is closed', async () => {
      const transport = new SSETransport();
      const stream = createMockStream({ closed: true });

      transport.registerStream('conv-1', stream);
      await transport.emit('conv-1', '{"type":"text"}');

      expect(stream.writeSSE).not.toHaveBeenCalled();
    });

    test('removes stream on write failure', async () => {
      const transport = new SSETransport();
      const stream = createMockStream({
        writeSSE: mock(() => Promise.reject(new Error('write failed'))),
      });

      transport.registerStream('conv-1', stream);
      await transport.emit('conv-1', '{"type":"text"}');

      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });
  });

  describe('emitWorkflowEvent', () => {
    test('writes to active stream', () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);
      transport.emitWorkflowEvent('conv-1', '{"type":"workflow_status"}');

      expect(stream.writeSSE).toHaveBeenCalledWith({ data: '{"type":"workflow_status"}' });
    });

    test('no-ops when no stream exists (consistent with emit)', () => {
      const transport = new SSETransport();

      // Should not throw
      transport.emitWorkflowEvent('conv-1', '{"type":"workflow_status"}');
    });
  });

  describe('hasActiveStream', () => {
    test('returns false when no stream registered', () => {
      const transport = new SSETransport();
      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });

    test('returns true for active stream', () => {
      const transport = new SSETransport();
      transport.registerStream('conv-1', createMockStream());
      expect(transport.hasActiveStream('conv-1')).toBe(true);
    });

    test('returns false for closed stream', () => {
      const transport = new SSETransport();
      transport.registerStream('conv-1', createMockStream({ closed: true }));
      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });
  });

  describe('buffer eviction warn throttle', () => {
    test('throttles repeated eviction warns to one per conversation per window', () => {
      // EVENT_BUFFER_MAX is 500; push 600 events into a conversation with no
      // active stream so all overflow events trigger an eviction. Even though
      // ~100 evictions happen, we should see exactly one warn (throttled).
      const transport = new SSETransport();
      mockLogger.warn.mockClear();

      for (let i = 0; i < 600; i++) {
        // emit() with no registered stream falls through to bufferEvent()
        void transport.emit('conv-throttle', `{"i":${i}}`);
      }

      const evictionWarns = mockLogger.warn.mock.calls.filter(
        (call: unknown[]) => call[1] === 'transport.buffer_evicted_oldest'
      );
      expect(evictionWarns.length).toBe(1);

      transport.stop();
    });
  });

  describe('start/stop', () => {
    test('start logs adapter_ready', () => {
      const transport = new SSETransport();
      transport.start();
      expect(mockLogger.info).toHaveBeenCalledWith('web.adapter_ready');
      transport.stop();
    });

    test('stop logs adapter_stopped', () => {
      const transport = new SSETransport();
      transport.start();
      mockLogger.info.mockClear();
      transport.stop();
      expect(mockLogger.info).toHaveBeenCalledWith('web.adapter_stopped');
    });

    test('stop closes all streams and clears state', () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.start();
      transport.registerStream('conv-1', stream);
      transport.stop();

      expect(stream.close).toHaveBeenCalledTimes(1);
      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });

    test('stop closes every dashboard subscriber and clears the fan-out set', () => {
      const transport = new SSETransport();
      const first = createMockStream();
      const second = createMockStream();

      transport.start();
      transport.registerStream('__dashboard__', first);
      transport.registerStream('__dashboard__', second);
      transport.stop();

      expect(first.close).toHaveBeenCalledTimes(1);
      expect(second.close).toHaveBeenCalledTimes(1);
      expect(transport.hasActiveStream('__dashboard__')).toBe(false);
    });

    test('stop cancels cleanup timers', () => {
      const cleanup = mock((_id: string) => undefined);
      const transport = new SSETransport(cleanup, 1);
      const stream = createMockStream();

      transport.start();
      transport.registerStream('conv-1', stream);
      transport.removeStream('conv-1');
      transport.stop();

      // Wait longer than grace period — cleanup should NOT fire (timer was cleared)
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(cleanup).not.toHaveBeenCalled();
          resolve();
        }, 50);
      });
    }, 1_000);
  });
});
