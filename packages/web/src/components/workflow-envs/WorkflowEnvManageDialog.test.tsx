/**
 * WorkflowEnvManageDialog tests — static NodePatchEditor markup plus mounted
 * create/edit flows (happy-dom) for no-op patches: {}.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installHappyDom, restoreHappyDom } from '@/test/install-happy-dom';
import { NodePatchEditor, WorkflowEnvEditorView } from './WorkflowEnvEditor';
import { WorkflowEnvManageDialog } from './WorkflowEnvManageDialog';
import {
  LOOP_GROUP_BODY_NOTE,
  PLAINTEXT_NOTICE,
  buildPatchesFromDrafts,
  emptyNodeDraft,
  type NodePatchDraft,
} from '@/lib/workflow-envs/editor';
import * as api from '@/lib/workflow-envs/api';
import type { WorkflowEnv, WorkflowEnvPreviewTarget } from '@/lib/workflow-envs/api';

const targets: WorkflowEnvPreviewTarget[] = [
  {
    id: 'plan',
    nodeType: 'prompt',
    allowedFields: ['provider', 'model', 'effort', 'thinking', 'prompt'],
  },
  {
    id: 'pack__step',
    nodeType: 'command',
    allowedFields: ['provider', 'model'],
  },
  {
    id: 'run_bash',
    nodeType: 'bash',
    allowedFields: ['bash'],
  },
];

function renderNode(
  draft: NodePatchDraft,
  allowedFields?: WorkflowEnvPreviewTarget['allowedFields']
): string {
  const target = targets.find(t => t.id === draft.nodeId) ?? targets[0];
  if (target === undefined) {
    throw new Error('test targets must not be empty');
  }
  const fields = allowedFields ?? target.allowedFields;
  return renderToStaticMarkup(
    createElement(NodePatchEditor, {
      draft,
      targets,
      allowedFields: fields,
      onChange: () => undefined,
      onRemove: () => undefined,
    })
  );
}

describe('NodePatchEditor allowed-field rendering', () => {
  test('prompt target shows provider/model/effort/thinking/prompt and not bash', () => {
    const html = renderNode(emptyNodeDraft('plan'));
    expect(html).toContain('data-testid="env-field-provider"');
    expect(html).toContain('data-testid="env-field-model"');
    expect(html).toContain('data-testid="env-field-effort"');
    expect(html).toContain('data-testid="env-field-thinking-mode"');
    expect(html).toContain('data-testid="env-field-prompt-enabled"');
    expect(html).not.toContain('data-testid="env-field-bash-enabled"');
  });

  test('bash target shows only bash field', () => {
    const html = renderNode(emptyNodeDraft('run_bash'));
    expect(html).toContain('data-testid="env-field-bash-enabled"');
    expect(html).not.toContain('data-testid="env-field-provider"');
    expect(html).not.toContain('data-testid="env-field-prompt-enabled"');
  });

  test('command target omits prompt and bash', () => {
    const html = renderNode(emptyNodeDraft('pack__step'));
    expect(html).toContain('data-testid="env-field-provider"');
    expect(html).toContain('data-testid="env-field-model"');
    expect(html).not.toContain('data-testid="env-field-prompt-enabled"');
    expect(html).not.toContain('data-testid="env-field-bash-enabled"');
  });

  test('explicitly enabled empty prompt/bash bodies render and are not dropped on save', () => {
    const promptHtml = renderNode({
      ...emptyNodeDraft('plan'),
      promptEnabled: true,
      prompt: '',
    });
    expect(promptHtml).toContain('data-testid="env-field-prompt-enabled"');
    expect(promptHtml).toContain('data-testid="env-field-prompt"');

    const bashHtml = renderNode({
      ...emptyNodeDraft('run_bash'),
      bashEnabled: true,
      bash: '',
    });
    expect(bashHtml).toContain('data-testid="env-field-bash-enabled"');
    expect(bashHtml).toContain('data-testid="env-field-bash"');

    // Dialog onSubmit uses buildPatchesFromDrafts — enabled empty bodies survive full-map save.
    const savedPrompt = buildPatchesFromDrafts(
      [{ ...emptyNodeDraft('plan'), promptEnabled: true, prompt: '' }],
      targets
    );
    expect(savedPrompt).toEqual({ ok: true, patches: { plan: { prompt: '' } } });

    const savedBash = buildPatchesFromDrafts(
      [{ ...emptyNodeDraft('run_bash'), bashEnabled: true, bash: '' }],
      targets
    );
    expect(savedBash).toEqual({ ok: true, patches: { run_bash: { bash: '' } } });

    // Untouched (disabled) body stays omitted.
    const omitted = buildPatchesFromDrafts(
      [{ ...emptyNodeDraft('plan'), provider: 'claude', promptEnabled: false, prompt: '' }],
      targets
    );
    expect(omitted).toEqual({ ok: true, patches: { plan: { provider: 'claude' } } });
  });
});

// ---------------------------------------------------------------------------
// Mounted create/edit — happy-dom + React.act (NODE_ENV=development for act)
// ---------------------------------------------------------------------------

interface Clickable {
  click: () => void;
  disabled?: boolean;
}

function asClickable(el: Element): Clickable {
  return el as unknown as Clickable;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Let fetch, JSON parsing and React Query state updates run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
  }
}

interface ReactChangeProps {
  onChange?: (e: { target: { value: string }; currentTarget: { value: string } }) => void;
}

function setInputValue(input: Element, value: string): void {
  // happy-dom native input/change events do not always drive React 19 controlled
  // inputs; invoke the fiber onChange prop with a minimal synthetic event.
  const propsKey = Object.keys(input).find(k => k.startsWith('__reactProps$'));
  let onChange: ReactChangeProps['onChange'];
  if (propsKey !== undefined && propsKey in input) {
    const props = (input as unknown as Record<string, unknown>)[propsKey];
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
  const el = input as unknown as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function requireTestId(root: Element, testId: string): Element {
  const el = root.querySelector(`[data-testid="${testId}"]`);
  if (el === null) {
    throw new Error(`missing [data-testid="${testId}"]`);
  }
  return el;
}

describe('WorkflowEnvEditorView mounted no-op patches', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    // React.act requires the development build.
    // happy-dom must be installed before createRoot.
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

  function EditorHarness(props: {
    mode: 'create' | 'edit';
    workflowName: string;
    envId: string | null;
    targets: WorkflowEnvPreviewTarget[];
    targetsLoading?: boolean;
    targetsError?: Error;
  }): ReactElement {
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    return createElement(WorkflowEnvEditorView, {
      mode: props.mode,
      workflowName: props.workflowName,
      envId: props.envId,
      targets: props.targets,
      targetsLoading: props.targetsLoading ?? false,
      targetsError: props.targetsError,
      busy,
      setBusy,
      actionError,
      setActionError,
      onCancel: () => undefined,
      onSaved: () => undefined,
    });
  }

  test('create flow with zero editable targets POSTs { patches: {} }', async () => {
    const createSpy = track(
      spyOn(api, 'createWorkflowEnv').mockImplementation(
        async (_wf: string, body: { name: string; patches: Record<string, unknown> }) => {
          const row: WorkflowEnv = {
            id: 'env-new',
            workflowName: 'feature',
            name: body.name,
            patches: body.patches as WorkflowEnv['patches'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            createdByUserId: null,
          };
          return row;
        }
      )
    );

    await act(async () => {
      root.render(
        createElement(EditorHarness, {
          mode: 'create',
          workflowName: 'feature',
          envId: null,
          // Discovery resolved successfully with zero targets.
          targets: [],
          targetsLoading: false,
        })
      );
    });
    await flush();

    const emptyCopy = host.querySelector('[data-testid="env-empty-patches"]');
    expect(emptyCopy?.textContent ?? '').toContain('no-op ENV');
    expect(emptyCopy?.textContent ?? '').toContain('patches: {}');
    expect(emptyCopy?.textContent ?? '').toContain('No editable target nodes');

    const submit = requireTestId(host, 'env-editor-submit');
    expect(asClickable(submit).disabled).toBe(false);

    const nameInput = requireTestId(host, 'env-editor-name');
    await act(async () => {
      setInputValue(nameInput, 'noop-env');
    });

    await act(async () => {
      asClickable(submit).click();
    });
    await flush();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[0]).toBe('feature');
    expect(createSpy.mock.calls[0]?.[1]).toEqual({
      name: 'noop-env',
      patches: {},
    });
  });

  test('edit flow removing every patch PATCHes complete { patches: {} }', async () => {
    const existing: WorkflowEnv = {
      id: 'env-1',
      workflowName: 'feature',
      name: 'was-fast',
      patches: { plan: { provider: 'claude' } },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdByUserId: null,
    };

    track(spyOn(api, 'getWorkflowEnv').mockResolvedValue(existing));

    const updateSpy = track(
      spyOn(api, 'updateWorkflowEnv').mockImplementation(
        async (
          _wf: string,
          envId: string,
          body: { name?: string; patches?: Record<string, unknown> }
        ) => ({
          ...existing,
          id: envId,
          name: body.name ?? existing.name,
          patches: (body.patches ?? existing.patches) as WorkflowEnv['patches'],
          updatedAt: '2026-01-02T00:00:00.000Z',
        })
      )
    );

    await act(async () => {
      root.render(
        createElement(EditorHarness, {
          mode: 'edit',
          workflowName: 'feature',
          envId: 'env-1',
          // Targets exist so the loaded draft can render, then be removed.
          targets,
          targetsLoading: false,
        })
      );
    });
    await flush();

    // Detail load resolved — draft row present.
    expect(host.querySelector('[data-testid="env-node-patch"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="env-empty-patches"]')).toBeNull();

    const removeBtn = Array.from(host.querySelectorAll('button')).find(
      b => b.getAttribute('aria-label') === 'Remove node patch'
    );
    if (removeBtn === undefined) {
      throw new Error('missing Remove node patch button');
    }

    await act(async () => {
      asClickable(removeBtn).click();
    });
    await flush();

    const emptyCopy = host.querySelector('[data-testid="env-empty-patches"]');
    expect(emptyCopy?.textContent ?? '').toContain('no-op ENV');
    expect(emptyCopy?.textContent ?? '').toContain('patches: {}');
    // Targets still exist; copy is "no patches yet" not "no editable target nodes".
    expect(emptyCopy?.textContent ?? '').toContain('No patches yet');

    const submit = requireTestId(host, 'env-editor-submit');
    expect(asClickable(submit).disabled).toBe(false);

    await act(async () => {
      asClickable(submit).click();
    });
    await flush();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]?.[0]).toBe('feature');
    expect(updateSpy.mock.calls[0]?.[1]).toBe('env-1');
    expect(updateSpy.mock.calls[0]?.[2]).toEqual({
      name: 'was-fast',
      patches: {},
    });
  });

  test('target discovery loading disables submit and does not POST', async () => {
    const createSpy = track(
      spyOn(api, 'createWorkflowEnv').mockResolvedValue({
        id: 'x',
        workflowName: 'feature',
        name: 'x',
        patches: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdByUserId: null,
      })
    );

    await act(async () => {
      root.render(
        createElement(EditorHarness, {
          mode: 'create',
          workflowName: 'feature',
          envId: null,
          targets: [],
          targetsLoading: true,
        })
      );
    });
    await flush();

    expect(host.textContent).toContain('Loading allowed target fields');
    const submit = requireTestId(host, 'env-editor-submit');
    expect(asClickable(submit).disabled).toBe(true);

    const nameInput = requireTestId(host, 'env-editor-name');
    await act(async () => {
      setInputValue(nameInput, 'blocked');
    });
    await flush();

    await act(async () => {
      // Force click even though disabled — onSubmit must still refuse if invoked.
      asClickable(submit).disabled = false;
      asClickable(submit).click();
    });
    await flush();

    expect(createSpy).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="env-editor-error"]')?.textContent ?? '').toMatch(
      /still loading/i
    );
  });

  test('target discovery failure disables submit and cannot overwrite ENV', async () => {
    const updateSpy = track(
      spyOn(api, 'updateWorkflowEnv').mockResolvedValue({
        id: 'env-1',
        workflowName: 'feature',
        name: 'keep',
        patches: { plan: { model: 'x' } },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdByUserId: null,
      })
    );
    track(
      spyOn(api, 'getWorkflowEnv').mockResolvedValue({
        id: 'env-1',
        workflowName: 'feature',
        name: 'keep',
        patches: { plan: { model: 'x' } },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdByUserId: null,
      })
    );

    await act(async () => {
      root.render(
        createElement(EditorHarness, {
          mode: 'edit',
          workflowName: 'feature',
          envId: 'env-1',
          targets: [],
          targetsLoading: false,
          targetsError: new Error('preview boom'),
        })
      );
    });
    await flush();

    expect(host.textContent).toContain('Baseline preview failed');
    expect(host.textContent).toContain('preview boom');
    const submit = requireTestId(host, 'env-editor-submit');
    expect(asClickable(submit).disabled).toBe(true);

    await act(async () => {
      asClickable(submit).disabled = false;
      asClickable(submit).click();
    });
    await flush();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="env-editor-error"]')?.textContent ?? '').toContain(
      'preview boom'
    );
  });

  test('create submit with zero thinking budget does not POST and keeps draft editable', async () => {
    const createSpy = track(
      spyOn(api, 'createWorkflowEnv').mockImplementation(
        async (_wf: string, body: { name: string; patches: Record<string, unknown> }) => ({
          id: 'env-new',
          workflowName: 'feature',
          name: body.name,
          patches: body.patches as WorkflowEnv['patches'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          createdByUserId: null,
        })
      )
    );

    await act(async () => {
      root.render(
        createElement(EditorHarness, {
          mode: 'create',
          workflowName: 'feature',
          envId: null,
          targets,
          targetsLoading: false,
        })
      );
    });
    await flush();

    const nameInput = requireTestId(host, 'env-editor-name');
    await act(async () => {
      setInputValue(nameInput, 'budget-zero');
    });

    const addBtn = Array.from(host.querySelectorAll('button')).find(b =>
      (b.textContent ?? '').includes('Node')
    );
    if (addBtn === undefined) {
      throw new Error('missing Node button');
    }
    await act(async () => {
      asClickable(addBtn).click();
    });
    await flush();

    // Default first target is plan (prompt) — set model + thinking enabled with budget 0.
    const modelInput = requireTestId(host, 'env-field-model');
    await act(async () => {
      setInputValue(modelInput, 'sonnet');
    });

    const thinkingMode = requireTestId(host, 'env-field-thinking-mode');
    await act(async () => {
      setInputValue(thinkingMode, 'enabled');
    });
    await flush();

    const budgetInput = requireTestId(host, 'env-field-thinking-budget');
    await act(async () => {
      setInputValue(budgetInput, '0');
    });
    await flush();

    await act(async () => {
      asClickable(requireTestId(host, 'env-editor-submit')).click();
    });
    await flush();

    expect(createSpy).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="env-editor-error"]')?.textContent ?? '').toMatch(
      /positive integer/i
    );

    // Draft remains editable — budget still shows 0, model still set, unrelated field editable.
    expect((requireTestId(host, 'env-field-thinking-budget') as HTMLInputElement).value).toBe('0');
    expect((requireTestId(host, 'env-field-model') as HTMLInputElement).value).toBe('sonnet');

    await act(async () => {
      setInputValue(requireTestId(host, 'env-field-model'), 'opus');
    });
    await flush();
    expect((requireTestId(host, 'env-field-model') as HTMLInputElement).value).toBe('opus');
    // Changing an unrelated field clears the local error (updateDraft).
    expect(host.querySelector('[data-testid="env-editor-error"]')).toBeNull();
    // Budget still 0 — not wiped.
    expect((requireTestId(host, 'env-field-thinking-budget') as HTMLInputElement).value).toBe('0');
    expect(createSpy).not.toHaveBeenCalled();
  });

  test('edit submit with zero thinking budget does not PATCH and keeps draft editable', async () => {
    const existing: WorkflowEnv = {
      id: 'env-1',
      workflowName: 'feature',
      name: 'was-fast',
      patches: {
        plan: {
          model: 'sonnet',
          thinking: { type: 'enabled', budgetTokens: 2048 },
        },
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdByUserId: null,
    };

    track(spyOn(api, 'getWorkflowEnv').mockResolvedValue(existing));
    const updateSpy = track(
      spyOn(api, 'updateWorkflowEnv').mockImplementation(
        async (
          _wf: string,
          envId: string,
          body: { name?: string; patches?: Record<string, unknown> }
        ) => ({
          ...existing,
          id: envId,
          name: body.name ?? existing.name,
          patches: (body.patches ?? existing.patches) as WorkflowEnv['patches'],
          updatedAt: '2026-01-02T00:00:00.000Z',
        })
      )
    );

    await act(async () => {
      root.render(
        createElement(EditorHarness, {
          mode: 'edit',
          workflowName: 'feature',
          envId: 'env-1',
          targets,
          targetsLoading: false,
        })
      );
    });
    await flush();

    expect(host.querySelector('[data-testid="env-node-patch"]')).not.toBeNull();
    expect((requireTestId(host, 'env-field-thinking-budget') as HTMLInputElement).value).toBe(
      '2048'
    );

    await act(async () => {
      setInputValue(requireTestId(host, 'env-field-thinking-budget'), '0');
    });
    await flush();

    await act(async () => {
      asClickable(requireTestId(host, 'env-editor-submit')).click();
    });
    await flush();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="env-editor-error"]')?.textContent ?? '').toMatch(
      /positive integer/i
    );

    // Unrelated provider field still editable; budget remains 0.
    const provider = requireTestId(host, 'env-field-provider');
    await act(async () => {
      setInputValue(provider, 'claude');
    });
    await flush();
    expect((requireTestId(host, 'env-field-provider') as HTMLInputElement).value).toBe('claude');
    expect((requireTestId(host, 'env-field-thinking-budget') as HTMLInputElement).value).toBe('0');
    expect((requireTestId(host, 'env-field-model') as HTMLInputElement).value).toBe('sonnet');
    expect(host.querySelector('[data-testid="env-editor-error"]')).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Mounted dialog: Radix portal content, list from the API, inline delete
// ---------------------------------------------------------------------------

describe('WorkflowEnvManageDialog mounted', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  const originalFetch = globalThis.fetch;
  let requests: { url: string; method: string }[] = [];
  let envRows: { id: string; workflowName: string; name: string; updatedAt: string }[] = [];

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    win = installHappyDom();
    // Radix's focus scope walks the dialog with NodeFilter, which the shared
    // happy-dom install does not expose.
    Object.defineProperty(globalThis, 'NodeFilter', {
      configurable: true,
      writable: true,
      value: win.NodeFilter,
    });
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    requests = [];
    envRows = [
      {
        id: 'env-1',
        workflowName: 'feature',
        name: 'fast-sonnet',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? 'GET';
      requests.push({ url, method });
      let payload: unknown;
      if (url.includes('/env-preview')) {
        payload = {
          preview: true,
          authoritative: false,
          workflowName: 'feature',
          envId: null,
          envName: null,
          skippedNodeIds: [],
          targets: targets,
          resolved: [],
        };
      } else if (method === 'DELETE') {
        envRows = [];
        payload = { success: true };
      } else {
        payload = { envs: envRows };
      }
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }) as typeof fetch;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, 'NodeFilter');
    win.close();
    restoreHappyDom();
  });

  function mount(props: { open: boolean; projectCwd: string | undefined }): ReactElement {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(
      QueryClientProvider,
      { client },
      createElement(WorkflowEnvManageDialog, {
        workflowName: 'feature',
        projectCwd: props.projectCwd,
        open: props.open,
        onClose: () => undefined,
      })
    );
  }

  function dialogRoot(): Element | null {
    return win.document.body.querySelector('[role="dialog"]') as unknown as Element | null;
  }

  test('closed dialog renders nothing and fetches nothing', async () => {
    await act(async () => {
      root.render(mount({ open: false, projectCwd: '/tmp/proj' }));
    });
    await flush();
    expect(dialogRoot()).toBeNull();
    expect(requests).toEqual([]);
  });

  test('open dialog lists overlays and shows plaintext and loop-group notices', async () => {
    await act(async () => {
      root.render(mount({ open: true, projectCwd: '/tmp/proj' }));
    });
    await settle();

    const dialog = dialogRoot();
    if (dialog === null) throw new Error('dialog did not open');
    const text = dialog.textContent ?? '';
    expect(text).toContain('feature');
    expect(text).toContain('fast-sonnet');
    expect(text).toContain(PLAINTEXT_NOTICE);
    expect(text).toContain(LOOP_GROUP_BODY_NOTE);
    expect(text.toLowerCase()).toContain('not encrypted');
    expect(text.toLowerCase()).not.toContain('encrypted at rest');
    expect(requireTestId(dialog, 'env-plaintext-notice')).not.toBeNull();
    expect(requireTestId(dialog, 'env-loop-group-note')).not.toBeNull();
  });

  test('delete asks for inline confirmation before calling the API', async () => {
    await act(async () => {
      root.render(mount({ open: true, projectCwd: '/tmp/proj' }));
    });
    await settle();

    const dialog = dialogRoot();
    if (dialog === null) throw new Error('dialog did not open');
    const findButton = (label: string): Element => {
      const found = Array.from(dialog.querySelectorAll('button')).find(
        b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label
      );
      if (found === undefined) throw new Error(`missing button ${label}`);
      return found;
    };

    await act(async () => {
      asClickable(findButton('Delete fast-sonnet')).click();
    });
    expect(requests.some(r => r.method === 'DELETE')).toBe(false);
    expect(dialog.textContent).toContain('Delete fast-sonnet?');

    await act(async () => {
      asClickable(findButton('Delete')).click();
    });
    await settle();

    const deletes = requests.filter(r => r.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.url).toBe('/api/workflows/feature/envs/env-1');
    expect(dialog.textContent).toContain('No environments yet.');
  });

  test('without a project, create and edit are disabled with a hint', async () => {
    await act(async () => {
      root.render(mount({ open: true, projectCwd: undefined }));
    });
    await settle();

    const dialog = dialogRoot();
    if (dialog === null) throw new Error('dialog did not open');
    const create = Array.from(dialog.querySelectorAll('button')).find(b =>
      (b.textContent ?? '').includes('Create environment')
    );
    if (create === undefined) throw new Error('missing create button');
    expect(asClickable(create).disabled).toBe(true);
    expect(dialog.textContent).toContain('Select a project');
    expect(requests.some(r => r.url.includes('/env-preview'))).toBe(false);
  });
});
