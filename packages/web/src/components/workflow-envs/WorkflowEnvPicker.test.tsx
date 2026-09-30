/**
 * WorkflowEnvPicker component tests: mounted picker with controlled async
 * list and preview responses.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement, useEffect, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installHappyDom, restoreHappyDom } from '@/test/install-happy-dom';
import { WorkflowEnvPicker } from './WorkflowEnvPicker';
import { WorkflowEnvPreviewTable } from './WorkflowEnvPreviewTable';
import { NONE_ENV_SELECTION } from '@/lib/workflow-envs/draft-env';
import type { WorkflowEnvPreview, WorkflowEnvSummary } from '@/lib/workflow-envs/api';

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface ReactChangeProps {
  onChange?: (e: { target: { value: string }; currentTarget: { value: string } }) => void;
}

function setSelectValue(select: Element, value: string): void {
  const propsKey = Object.keys(select).find(k => k.startsWith('__reactProps$'));
  let onChange: ReactChangeProps['onChange'];
  if (propsKey !== undefined && propsKey in select) {
    const props = (select as unknown as Record<string, unknown>)[propsKey];
    if (props !== null && typeof props === 'object' && 'onChange' in props) {
      const candidate = (props as ReactChangeProps).onChange;
      if (typeof candidate === 'function') {
        onChange = candidate;
      }
    }
  }
  if (onChange !== undefined) {
    onChange({ target: { value }, currentTarget: { value } });
    return;
  }
  const el = select as unknown as HTMLSelectElement;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function requireSelect(root: Element): HTMLSelectElement {
  const el = root.querySelector('select#workflow-run-env');
  if (!(el instanceof HTMLSelectElement)) {
    throw new Error('missing ENV select');
  }
  return el;
}

const envsA: WorkflowEnvSummary[] = [
  {
    id: 'env-a1',
    workflowName: 'wf-a',
    name: 'fast-a',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const envsB: WorkflowEnvSummary[] = [
  {
    id: 'env-b1',
    workflowName: 'wf-b',
    name: 'fast-b',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function previewFor(
  workflowName: string,
  envId: string | null,
  envName: string | null
): WorkflowEnvPreview {
  return {
    preview: true,
    authoritative: false,
    workflowName,
    envId,
    envName,
    skippedNodeIds: [],
    targets: [],
    resolved:
      envId === null
        ? []
        : [
            {
              nodeId: 'plan',
              provider: 'claude',
              model: `${workflowName}-model`,
            },
          ],
  };
}

/**
 * Controlled harness: async list + preview keyed by workflow/env, mirrors
 * the race-safe selection surface without the full workflow detail pane.
 */
function AsyncEnvPickerHarness(props: {
  workflowName: string;
  listLoader: (workflowName: string) => Promise<WorkflowEnvSummary[]>;
  previewLoader: (workflowName: string, envId: string | null) => Promise<WorkflowEnvPreview>;
  onSelectionChange?: (envId: string | null) => void;
}): ReactElement {
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(NONE_ENV_SELECTION);
  const [envs, setEnvs] = useState<WorkflowEnvSummary[]>([]);
  const [listError, setListError] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [preview, setPreview] = useState<WorkflowEnvPreview | undefined>(undefined);
  const [previewError, setPreviewError] = useState<Error | undefined>(undefined);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(false);
    setEnvs([]);
    // Workflow switch clears ENV immediately (card contract).
    setSelectedEnvId(NONE_ENV_SELECTION);
    setPreview(undefined);
    setPreviewError(undefined);
    void props.listLoader(props.workflowName).then(
      (rows: WorkflowEnvSummary[]): void => {
        if (cancelled) return;
        setEnvs(rows);
        setListLoading(false);
      },
      (): void => {
        if (cancelled) return;
        setListError(true);
        setListLoading(false);
      }
    );
    return (): void => {
      cancelled = true;
    };
  }, [props.workflowName, props.listLoader]);

  useEffect(() => {
    let cancelled = false;
    setPreview(undefined);
    setPreviewError(undefined);
    setPreviewLoading(true);
    void props.previewLoader(props.workflowName, selectedEnvId).then(
      (row: WorkflowEnvPreview): void => {
        if (cancelled) return;
        setPreview(row);
        setPreviewLoading(false);
      },
      (err: unknown): void => {
        if (cancelled) return;
        setPreviewError(err instanceof Error ? err : new Error(String(err)));
        setPreviewLoading(false);
      }
    );
    return (): void => {
      cancelled = true;
    };
  }, [props.workflowName, selectedEnvId, props.previewLoader]);

  return createElement(
    'div',
    { 'data-testid': 'env-picker-harness' },
    createElement('div', {
      'data-testid': 'harness-workflow',
      children: props.workflowName,
    }),
    createElement('div', {
      'data-testid': 'harness-selected',
      children: selectedEnvId ?? 'none',
    }),
    listLoading
      ? createElement('div', { 'data-testid': 'harness-list-loading' }, 'Loading ENV list…')
      : null,
    createElement(WorkflowEnvPicker, {
      envs,
      value: selectedEnvId,
      listError,
      onChange: (next: string | null): void => {
        setSelectedEnvId(next);
        props.onSelectionChange?.(next);
      },
    }),
    createElement(WorkflowEnvPreviewTable, {
      preview,
      loading: previewLoading || (preview === undefined && previewError === undefined),
      error: previewError,
      envSelected: selectedEnvId !== null,
    })
  );
}

describe('WorkflowEnvPicker mounted async list/preview', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

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
    win.close();
    restoreHappyDom();
  });

  test('None (YAML) is the default selection', async () => {
    const list = deferred<WorkflowEnvSummary[]>();
    const preview = deferred<WorkflowEnvPreview>();

    await act(async () => {
      root.render(
        createElement(AsyncEnvPickerHarness, {
          workflowName: 'wf-a',
          listLoader: (): Promise<WorkflowEnvSummary[]> => list.promise,
          previewLoader: (): Promise<WorkflowEnvPreview> => preview.promise,
        })
      );
    });
    await flush();

    const select = requireSelect(host);
    expect(select.value).toBe('');
    expect(host.querySelector('[data-testid="harness-selected"]')?.textContent).toBe('none');
    expect(host.textContent).toContain('None (YAML)');

    await act(async () => {
      list.resolve(envsA);
      preview.resolve(previewFor('wf-a', null, null));
    });
    await flush();

    expect(select.value).toBe('');
    expect(host.querySelector('[data-testid="harness-selected"]')?.textContent).toBe('none');
  });

  test('list failure keeps None usable and does not invent ENVs', async () => {
    const list = deferred<WorkflowEnvSummary[]>();
    const preview = deferred<WorkflowEnvPreview>();

    await act(async () => {
      root.render(
        createElement(AsyncEnvPickerHarness, {
          workflowName: 'wf-a',
          listLoader: (): Promise<WorkflowEnvSummary[]> => list.promise,
          previewLoader: (): Promise<WorkflowEnvPreview> => preview.promise,
        })
      );
    });
    await flush();

    await act(async () => {
      list.reject(new Error('list down'));
      preview.resolve(previewFor('wf-a', null, null));
    });
    await flush();

    expect(host.textContent).toContain(
      'Environment list unavailable. Running from the workflow YAML still works.'
    );
    expect(requireSelect(host).value).toBe('');
    // Failed list must not render phantom option names from a prior success.
    expect(host.textContent).not.toContain('fast-a');
    expect(host.textContent).not.toContain('fast-b');
  });

  test('retained selected id stays visible with its own loading/error state', async () => {
    const listOk = deferred<WorkflowEnvSummary[]>();
    const preview1 = deferred<WorkflowEnvPreview>();

    await act(async () => {
      root.render(
        createElement(AsyncEnvPickerHarness, {
          workflowName: 'wf-a',
          listLoader: (): Promise<WorkflowEnvSummary[]> => listOk.promise,
          previewLoader: (_wf: string, envId: string | null): Promise<WorkflowEnvPreview> => {
            if (envId === 'env-a1') return preview1.promise;
            return Promise.resolve(previewFor('wf-a', null, null));
          },
        })
      );
    });
    await flush();

    await act(async () => {
      listOk.resolve(envsA);
    });
    await flush();

    const select = requireSelect(host);
    await act(async () => {
      setSelectValue(select, 'env-a1');
    });
    await flush();

    expect(host.querySelector('[data-testid="harness-selected"]')?.textContent).toBe('env-a1');
    expect(host.textContent).toContain('Loading ENV preview');

    // List later fails while selection is retained — missing option stays visible.
    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(WorkflowEnvPicker, {
            envs: [],
            value: 'env-a1',
            listError: true,
            onChange: (): void => undefined,
          }),
          createElement(WorkflowEnvPreviewTable, {
            preview: undefined,
            loading: false,
            error: new Error('preview boom'),
            envSelected: true,
          })
        )
      );
    });
    await flush();

    const retained = requireSelect(host);
    expect(retained.value).toBe('env-a1');
    expect(host.textContent).toContain('selected (env-a1)');
    expect(host.textContent).toContain('Run is disabled');
    expect(host.textContent).toContain('preview boom');
    // Selection was not silently reset to None.
    expect(retained.value).not.toBe('');
  });

  test('stale prior-workflow list/preview cannot replace current options', async () => {
    const listA = deferred<WorkflowEnvSummary[]>();
    const listB = deferred<WorkflowEnvSummary[]>();
    const previewA = deferred<WorkflowEnvPreview>();
    const previewB = deferred<WorkflowEnvPreview>();

    const listLoader = (wf: string): Promise<WorkflowEnvSummary[]> =>
      wf === 'wf-a' ? listA.promise : listB.promise;
    const previewLoader = (wf: string, _envId: string | null): Promise<WorkflowEnvPreview> =>
      wf === 'wf-a' ? previewA.promise : previewB.promise;

    await act(async () => {
      root.render(
        createElement(AsyncEnvPickerHarness, {
          workflowName: 'wf-a',
          listLoader,
          previewLoader,
        })
      );
    });
    await flush();

    // Switch to wf-b before wf-a settles.
    await act(async () => {
      root.render(
        createElement(AsyncEnvPickerHarness, {
          workflowName: 'wf-b',
          listLoader,
          previewLoader,
        })
      );
    });
    await flush();

    expect(host.querySelector('[data-testid="harness-workflow"]')?.textContent).toBe('wf-b');
    expect(host.querySelector('[data-testid="harness-selected"]')?.textContent).toBe('none');

    // Current workflow resolves first.
    await act(async () => {
      listB.resolve(envsB);
      previewB.resolve(previewFor('wf-b', null, null));
    });
    await flush();

    expect(host.textContent).toContain('fast-b');
    expect(host.textContent).not.toContain('fast-a');

    // Stale prior-workflow responses arrive late — must not overwrite.
    await act(async () => {
      listA.resolve(envsA);
      previewA.resolve(previewFor('wf-a', null, null));
    });
    await flush();

    expect(host.querySelector('[data-testid="harness-workflow"]')?.textContent).toBe('wf-b');
    expect(host.textContent).toContain('fast-b');
    expect(host.textContent).not.toContain('fast-a');
    expect(host.textContent).not.toContain('wf-a-model');
  });
});
