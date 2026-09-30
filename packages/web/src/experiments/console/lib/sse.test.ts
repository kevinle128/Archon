process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import { subscribeKey } from '../store/cache';
import { K } from '../store/keys';
import { useRunStreamSSE } from './sse';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const act = react.act;
const createRoot = reactDomClient.createRoot;

/**
 * Minimal EventSource stand-in. happy-dom does not implement EventSource at
 * all, so real reconnect semantics can't be exercised — this mock instead
 * lets the test drive `onopen` directly to prove the hook's own reconnect
 * handling: refetch on every open AFTER the first, never on the first.
 */
class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close(): void {
    this.readyState = 2;
  }
}

describe('useRunStreamSSE reconnect', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    MockEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    globalThis.EventSource = originalEventSource;
    win.close();
    restoreHappyDom();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  test('a reconnect (second+ open) refetches run + messages; the first open does not', async () => {
    const runId = 'run-sse-reconnect';
    const conversationPlatformId = 'conv-sse-reconnect';
    let runLoads = 0;
    let messageLoads = 0;
    const unsubRun = subscribeKey(
      K.run(runId),
      () => {},
      () => {
        runLoads += 1;
        return Promise.resolve({ id: runId });
      }
    );
    const unsubMessages = subscribeKey(
      K.messages(conversationPlatformId),
      () => {},
      () => {
        messageLoads += 1;
        return Promise.resolve([]);
      }
    );
    await flush();
    expect(runLoads).toBe(1);
    expect(messageLoads).toBe(1);

    function Probe(): ReactElement | null {
      useRunStreamSSE(conversationPlatformId, runId);
      return null;
    }
    await act(async () => {
      root.render(createElement(Probe));
    });
    await flush();

    const es = MockEventSource.instances.at(-1);
    if (es === undefined) throw new Error('EventSource not constructed');

    // First open: the initial connect, already covered by the loads above.
    es.onopen?.();
    await flush();
    expect(runLoads).toBe(1);
    expect(messageLoads).toBe(1);

    // Reconnect: a genuine drop-then-recover, so both caches must refresh
    // without waiting for any slower safety-net poll.
    es.onopen?.();
    await flush();
    expect(runLoads).toBe(2);
    expect(messageLoads).toBe(2);

    // A further reconnect keeps refetching — not a one-shot.
    es.onopen?.();
    await flush();
    expect(runLoads).toBe(3);
    expect(messageLoads).toBe(3);

    unsubRun();
    unsubMessages();
  });
});
