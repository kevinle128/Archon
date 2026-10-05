process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import type { FilesChangedResponse } from '@/lib/api';

const react = await import('react');
const reactQuery = await import('@tanstack/react-query');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;
const notifyManager = reactQuery.notifyManager;

Object.assign(globalThis as object, { IS_REACT_ACT_ENVIRONMENT: true });

const mockGetFilesChanged = mock(
  async (_runId: string, _options?: { signal?: AbortSignal }): Promise<FilesChangedResponse> => ({
    files: [],
  })
);

mock.module('@/lib/api', () => ({
  getWorkflowRunFilesChanged: mockGetFilesChanged,
}));

const filesChangedTabModule = await import('./files-changed-tab');

let host: HTMLDivElement;
let root: Root;
let queryClient: InstanceType<typeof reactQuery.QueryClient>;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await flush();
    if (predicate()) return;
  }
  throw new Error(`condition never met: ${host.textContent ?? ''}`);
}

async function mount(runId = 'run-1'): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        reactQuery.QueryClientProvider,
        { client: queryClient },
        createElement(filesChangedTabModule.FilesChangedTab, { runId })
      )
    );
  });
}

beforeEach(() => {
  mockGetFilesChanged.mockReset();
  notifyManager.setScheduler((cb: () => void): void => {
    cb();
  });
  notifyManager.setNotifyFunction((cb: () => void): void => {
    act(cb);
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  queryClient = new reactQuery.QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  queryClient.clear();
  host.remove();
  notifyManager.setScheduler((cb: () => void): void => {
    setTimeout(cb, 0);
  });
});

describe('FilesChangedTab', () => {
  test('shows the approved empty state when the run has no changed files', async () => {
    mockGetFilesChanged.mockResolvedValueOnce({ files: [] });
    await mount();
    await flushUntil(() =>
      (host.textContent ?? '').includes('No repository changes recorded for this run.')
    );

    expect(host.textContent).toContain('No repository changes recorded for this run.');
  });

  test('shows the CAP-6 empty envelope the same way', async () => {
    mockGetFilesChanged.mockResolvedValueOnce({ emptyReason: 'no_checkout', files: [] });
    await mount();
    await flushUntil(() =>
      (host.textContent ?? '').includes('No repository changes recorded for this run.')
    );

    expect(host.textContent).toContain('No repository changes recorded for this run.');
  });

  test('lists changed paths with their proven node execution', async () => {
    mockGetFilesChanged.mockResolvedValueOnce({
      files: [
        {
          path: 'src/build.ts',
          status: 'M',
          executions: [{ nodeId: 'build', retryEpoch: 0, startedAt: 't1', endedAt: 't2' }],
        },
      ],
    });
    await mount();
    await flushUntil(() => (host.textContent ?? '').includes('src/build.ts'));

    expect(host.textContent).toContain('Files changed');
    expect(host.textContent).toContain('src/build.ts');
    expect(host.textContent).toContain('build');
  });

  test('shows unknown for a path with no proven execution', async () => {
    mockGetFilesChanged.mockResolvedValueOnce({
      files: [{ path: 'src/mystery.ts', status: 'A', executions: [] }],
    });
    await mount();
    await flushUntil(() => (host.textContent ?? '').includes('src/mystery.ts'));

    expect(host.textContent).toContain('unknown');
  });

  test('shows a distinct message when the fetch fails', async () => {
    mockGetFilesChanged.mockRejectedValueOnce(new Error('network down'));
    await mount();
    await flushUntil(() => (host.textContent ?? '').includes('Could not load files changed'));

    expect(host.textContent).toContain('Could not load files changed');
  });
});
