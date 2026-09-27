process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import type { ExecutionHeaderModel } from '@/lib/execution-room-model';
import { installHappyDom, restoreHappyDom } from '@/experiments/console/test/install-happy-dom';

const react = await import('react');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

const ITERATION_TWO: ExecutionHeaderModel = {
  nodeId: 'review',
  nodeLabel: 'Review',
  executionLabel: 'Iteration 2',
  status: 'running',
  startedOffsetMs: 1500,
  startedAt: '2026-09-08T04:52:00.000Z',
  durationMs: null,
  provider: 'openai',
  model: 'gpt-5',
  unknownScope: false,
  isLoopIteration: false,
};

function closeButton(host: Element): Element {
  const button = host.querySelector('button[aria-label="Close"]');
  if (button === null) throw new Error('missing Close button');
  return button;
}

describe('NodeRoomHeader', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  let nodeRoomHeader: typeof import('./NodeRoomHeader');

  beforeEach(async () => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    nodeRoomHeader = await import('./NodeRoomHeader');
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  test('renders the node-kind chip, name, status pill, meta line, and execution picker', async () => {
    const selected: string[] = [];
    const closes: number[] = [];

    await act(async () => {
      root.render(
        createElement(nodeRoomHeader.NodeRoomHeader, {
          model: ITERATION_TWO,
          options: [
            { rowId: 'iter-1', label: 'Iteration 1' },
            { rowId: 'iter-2', label: 'Iteration 2' },
          ],
          selectedRowId: 'iter-2',
          onSelectRow: (rowId: string): void => {
            selected.push(rowId);
          },
          onClose: (): void => {
            closes.push(1);
          },
          kindChip: { label: 'loop', tone: 'node-loop' },
          executionCount: 3,
          runOfTotal: { run: 2, total: 2 },
        })
      );
    });

    const text = host.textContent ?? '';
    expect(text).toContain('loop');
    expect(text).toContain('Review');
    expect(text).toContain('Running');
    expect(text).toContain('started');
    expect(text).toContain('running…');
    expect(text).toContain('run 2 of 2');
    expect(text).toContain('execution');
    expect(text).toContain('of 3 · max 8');
    expect(text).toContain('openai');
    expect(text).toContain('gpt-5');
    expect(text).not.toContain('—');
    expect(host.querySelector('header')).not.toBeNull();

    const select = host.querySelector('select[aria-label="Execution"]');
    if (select === null) {
      throw new Error('missing execution select');
    }
    const executionSelect = select as unknown as HTMLSelectElement;
    expect(executionSelect.value).toBe('iter-2');

    await act(async () => {
      executionSelect.value = 'iter-1';
      executionSelect.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
    });
    expect(selected).toEqual(['iter-1']);

    await act(async () => {
      closeButton(host).dispatchEvent(
        new win.Event('click', { bubbles: true }) as unknown as Event
      );
    });
    expect(closes).toEqual([1]);
  });

  test('omits the kind chip, meta line, and picker when their own data is absent', async () => {
    await act(async () => {
      root.render(
        createElement(nodeRoomHeader.NodeRoomHeader, {
          model: {
            ...ITERATION_TWO,
            status: 'completed',
            startedAt: null,
            startedOffsetMs: null,
            durationMs: null,
            provider: null,
            model: null,
          },
          options: [{ rowId: 'iter-2', label: 'Iteration 2' }],
          selectedRowId: 'iter-2',
          onSelectRow: (): void => undefined,
          onClose: (): void => undefined,
          kindChip: null,
          executionCount: 1,
        })
      );
    });

    const text = host.textContent ?? '';
    expect(text).toContain('Review');
    expect(text).toContain('Completed');
    expect(text).not.toContain('openai');
    expect(text).not.toContain('gpt-5');
    expect(text).not.toContain('started');
    expect(host.querySelector('select[aria-label="Execution"]')).toBeNull();
  });
});
