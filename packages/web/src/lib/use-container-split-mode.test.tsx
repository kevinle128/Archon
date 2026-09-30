process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ReactElement, RefObject } from 'react';
import type { Root } from 'react-dom/client';

import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const splitMode = await import('./use-container-split-mode');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

type ResizeObserverCallback = (
  entries: { contentRect: { width: number } }[],
  observer: unknown
) => void;

interface FakeResizeObserverInstance {
  callback: ResizeObserverCallback;
  disconnect(): void;
}

function Probe(props: {
  containerRef: RefObject<HTMLDivElement | null>;
  minRem?: number;
}): ReactElement {
  const mode = splitMode.useContainerSplitMode(props.containerRef, props.minRem);
  return createElement('div', {
    ref: props.containerRef,
    'data-mode': mode,
    'data-testid': 'split-probe',
  });
}

describe('useContainerSplitMode', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  let observers: FakeResizeObserverInstance[];
  let disconnectCount: number;
  let reportedWidth: number;
  let originalRectDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    win = installHappyDom();
    observers = [];
    disconnectCount = 0;
    reportedWidth = 0;
    originalRectDescriptor = Object.getOwnPropertyDescriptor(
      win.HTMLElement.prototype,
      'getBoundingClientRect'
    );

    Object.defineProperty(win.HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: function getBoundingClientRect(): { width: number } {
        return { width: reportedWidth };
      },
    });

    class FakeResizeObserver {
      callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }

      observe(): void {
        return;
      }

      unobserve(): void {
        return;
      }

      disconnect(): void {
        disconnectCount += 1;
      }
    }

    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: FakeResizeObserver,
    });

    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    if (originalRectDescriptor !== undefined) {
      Object.defineProperty(
        win.HTMLElement.prototype,
        'getBoundingClientRect',
        originalRectDescriptor
      );
    }
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
    win.close();
    restoreHappyDom();
  });

  async function renderProbe(): Promise<HTMLElement> {
    const containerRef: RefObject<HTMLDivElement | null> = { current: null };
    await act(async () => {
      root.render(createElement(Probe, { containerRef }));
    });
    const probe = host.querySelector('[data-testid="split-probe"]');
    expect(probe).not.toBeNull();
    return probe as HTMLElement;
  }

  function reportWidth(width: number): void {
    for (const observer of observers) {
      observer.callback([{ contentRect: { width } }], observer);
    }
  }

  test('uses 16px root font: 959 is single and 960 is split', async () => {
    win.document.documentElement.style.fontSize = '16px';
    const probe = await renderProbe();
    await act(async () => {
      reportWidth(959);
    });
    expect(probe.getAttribute('data-mode')).toBe('single');
    await act(async () => {
      reportWidth(960);
    });
    expect(probe.getAttribute('data-mode')).toBe('split');
  });

  test('uses 20px root font: 1199 is single and 1200 is split', async () => {
    win.document.documentElement.style.fontSize = '20px';
    const probe = await renderProbe();
    await act(async () => {
      reportWidth(1199);
    });
    expect(probe.getAttribute('data-mode')).toBe('single');
    await act(async () => {
      reportWidth(1200);
    });
    expect(probe.getAttribute('data-mode')).toBe('split');
  });

  test('falls back to getBoundingClientRect when ResizeObserver is missing', async () => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
    win.document.documentElement.style.fontSize = '16px';
    reportedWidth = 959;
    const probe = await renderProbe();
    expect(probe.getAttribute('data-mode')).toBe('single');
    reportedWidth = 960;
    const containerRef: RefObject<HTMLDivElement | null> = { current: null };
    await act(async () => {
      root.render(createElement(Probe, { containerRef }));
    });
    const rerendered = host.querySelector('[data-testid="split-probe"]');
    expect(rerendered?.getAttribute('data-mode')).toBe('split');
  });

  test('disconnects the observer on unmount', async () => {
    await renderProbe();
    expect(observers.length).toBe(1);
    await act(async () => {
      root.unmount();
    });
    expect(disconnectCount).toBe(1);
  });
});
