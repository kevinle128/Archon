process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import { useRunTerminalEdge } from './useRunTerminalEdge';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const act = react.act;
const createRoot = reactDomClient.createRoot;

/** Minimal EventSource stand-in; happy-dom implements none. */
class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close(): void {
    /* no-op */
  }
  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

describe('useRunTerminalEdge', () => {
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

  function mountProbe(runId: string, onRunEvent: () => void): Promise<void> {
    function Probe(): ReactElement | null {
      useRunTerminalEdge(runId, onRunEvent);
      return null;
    }
    return act(async () => {
      root.render(createElement(Probe));
    });
  }

  test('fires for dag_node and workflow_status events matching this runId only', async () => {
    let calls = 0;
    await mountProbe('run-1', () => {
      calls += 1;
    });
    const es = MockEventSource.instances.at(-1);
    if (es === undefined) throw new Error('EventSource not constructed');

    // Different run — must not fire.
    await act(async () => {
      es.emit({ type: 'dag_node', runId: 'run-other', nodeId: 'n1', status: 'completed' });
    });
    expect(calls).toBe(0);

    // This run, dag_node — fires.
    await act(async () => {
      es.emit({ type: 'dag_node', runId: 'run-1', nodeId: 'n1', status: 'completed' });
    });
    expect(calls).toBe(1);

    // This run, workflow_status — fires.
    await act(async () => {
      es.emit({ type: 'workflow_status', runId: 'run-1', status: 'completed' });
    });
    expect(calls).toBe(2);

    // This run, an event type the kick doesn't care about — must not fire.
    await act(async () => {
      es.emit({ type: 'workflow_tool_activity', runId: 'run-1' });
    });
    expect(calls).toBe(2);

    // Heartbeat / malformed payloads never fire.
    await act(async () => {
      es.emit({ type: 'heartbeat' });
      es.onmessage?.({ data: 'not json' } as MessageEvent<string>);
    });
    expect(calls).toBe(2);
  });

  test('connects to the dashboard stream, not a per-conversation stream', async () => {
    await mountProbe('run-2', () => {});
    const es = MockEventSource.instances.at(-1);
    expect(es?.url).toContain('__dashboard__');
  });
});
