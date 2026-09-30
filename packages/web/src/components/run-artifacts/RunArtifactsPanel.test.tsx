process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Root } from 'react-dom/client';

import { RunArtifactsUnavailableError, type RunArtifactFile } from '@/lib/run-artifacts/api';
import { RunArtifactsPanel } from './RunArtifactsPanel';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const act = react.act;

const GLOBAL_KEYS = [
  'window',
  'document',
  'self',
  'HTMLElement',
  'Element',
  'Node',
  'Text',
  'DocumentFragment',
  'SVGElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'navigator',
  'location',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MutationObserver',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;

const previous = new Map<string, PropertyDescriptor | undefined>();

function install(win: Window): void {
  previous.clear();
  for (const key of GLOBAL_KEYS) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  const source = win as unknown as Record<string, unknown>;
  const bag: Record<string, unknown> = { IS_REACT_ACT_ENVIRONMENT: true, self: win };
  for (const key of GLOBAL_KEYS) {
    if (key in bag) continue;
    const value = source[key];
    bag[key] = typeof value === 'function' && key.startsWith('get') ? value.bind(win) : value;
  }
  bag.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    Number(win.requestAnimationFrame(cb as unknown as (time: number) => void));
  bag.cancelAnimationFrame = win.cancelAnimationFrame.bind(win);
  Object.assign(globalThis as object, bag);
}

function restore(): void {
  for (const key of GLOBAL_KEYS) {
    const descriptor = previous.get(key);
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, descriptor);
  }
  previous.clear();
}

const FILES: RunArtifactFile[] = [
  { path: 'plan.md', size: 20, modifiedAt: '2026-09-30T00:00:00.000Z' },
  { path: 'logs/out.txt', size: 2048, modifiedAt: '2026-09-30T00:00:00.000Z' },
];

describe('RunArtifactsPanel', () => {
  let win: Window;
  let root: Root;
  let onClose: ReturnType<typeof mock>;

  beforeEach(() => {
    win = new Window({ url: 'https://localhost/' });
    install(win);
    const host = win.document.createElement('div');
    win.document.body.appendChild(host);
    root = reactDomClient.createRoot(host as unknown as Element);
    onClose = mock(() => undefined);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    await win.happyDOM.close();
    restore();
  });

  async function renderPanel(
    loadFiles: (runId: string) => Promise<RunArtifactFile[]>,
    loadFile: (runId: string, path: string) => Promise<string> = async (): Promise<string> => 'body'
  ): Promise<void> {
    await act(async () => {
      root.render(
        <RunArtifactsPanel
          runId="run-1"
          reportedArtifacts={[]}
          onClose={onClose as unknown as () => void}
          loadFiles={loadFiles}
          loadFile={loadFile}
        />
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  test('lists files and auto-selects the first one', async () => {
    const loadFile = mock(async (_runId: string, path: string): Promise<string> => `# ${path}`);
    await renderPanel(async () => FILES, loadFile);
    const text = win.document.body.textContent;
    expect(text).toContain('plan.md');
    expect(text).toContain('logs/out.txt');
    expect(text).toContain('2.0 KB');
    expect(loadFile).toHaveBeenCalledWith('run-1', 'plan.md');
    const buttons = Array.from(win.document.querySelectorAll('nav button'));
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0].className).toContain('bg-accent-muted');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
  });

  test('shows the empty state when the directory holds no files', async () => {
    await renderPanel(async () => []);
    expect(win.document.body.textContent).toContain('No artifacts written to disk for this run.');
  });

  test('shows unavailable, not empty, when the output location is unresolved', async () => {
    await renderPanel(async () => {
      throw new RunArtifactsUnavailableError('run-1');
    });
    const text = win.document.body.textContent;
    expect(text).toContain('Artifacts unavailable for this run.');
    expect(text).not.toContain('No artifacts written to disk');
  });

  test('shows other list errors with their message', async () => {
    const spy = mock(() => undefined);
    const original = console.error;
    console.error = spy;
    try {
      await renderPanel(async () => {
        throw new Error('boom');
      });
    } finally {
      console.error = original;
    }
    expect(win.document.body.textContent).toContain('Could not list artifacts: boom');
  });

  test('close button and Escape both call onClose', async () => {
    await renderPanel(async () => []);
    const close = win.document.querySelector('button[aria-label="Close artifacts"]');
    await act(async () => {
      (close as unknown as HTMLElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('Escape typed inside a text field does not close the panel', async () => {
    await renderPanel(async () => []);
    const input = win.document.createElement('textarea');
    win.document.body.appendChild(input);
    await act(async () => {
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
