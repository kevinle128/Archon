import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import { FilesChangedPanel } from './FilesChangedPanel';
import * as skill from '../skills';
import type { FilesChangedResponse } from '../skills/runs';

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('FilesChangedPanel', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    for (const s of spies.splice(0)) s.mockRestore();
    win.close();
    restoreHappyDom();
  });

  function track<T extends { mockRestore: () => void }>(s: T): T {
    spies.push(s);
    return s;
  }

  async function mount(runId: string): Promise<void> {
    await act(async () => {
      root.render(createElement(FilesChangedPanel, { runId }));
    });
    await flush();
    await flush();
  }

  test('shows the approved empty state when the run has no changed files', async () => {
    track(spyOn(skill, 'getFilesChanged').mockResolvedValue({ files: [] } as FilesChangedResponse));

    await mount('run-empty');

    expect(host.textContent).toContain('No repository changes recorded for this run.');
  });

  test('lists a changed path with its proven node execution', async () => {
    track(
      spyOn(skill, 'getFilesChanged').mockResolvedValue({
        files: [
          {
            path: 'src/build.ts',
            status: 'M',
            executions: [{ nodeId: 'build', retryEpoch: 0, startedAt: 't1', endedAt: 't2' }],
          },
        ],
      } as FilesChangedResponse)
    );

    await mount('run-attributed');

    expect(host.textContent).toContain('Files changed');
    expect(host.textContent).toContain('src/build.ts');
    expect(host.textContent).toContain('build');
  });

  test('shows unknown for a path with no proven execution', async () => {
    track(
      spyOn(skill, 'getFilesChanged').mockResolvedValue({
        files: [{ path: 'src/mystery.ts', status: 'A', executions: [] }],
      } as FilesChangedResponse)
    );

    await mount('run-unknown');

    expect(host.textContent).toContain('unknown');
  });

  test('shows a distinct message when the fetch fails', async () => {
    track(spyOn(skill, 'getFilesChanged').mockRejectedValue(new Error('network down')));

    await mount('run-error');

    expect(host.textContent).toContain('Could not load files changed');
  });
});
