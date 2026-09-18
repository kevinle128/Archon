process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import { installHappyDom, restoreHappyDom } from '@/experiments/console/test/install-happy-dom';
import type { SendWorkflowNodeBody, SendWorkflowNodeResponse } from '@/lib/api';
import { SteeringSendError } from '@/lib/steering-dock';
import type { SendNodeGuidance } from './ComposerDock';

const react = await import('react');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

let composerModulePromise: Promise<typeof import('./ComposerDock')> | null = null;

async function loadComposerModule(): Promise<typeof import('./ComposerDock')> {
  if (composerModulePromise === null) {
    let tempWin: ReturnType<typeof installHappyDom> | null = null;
    if (typeof globalThis.document === 'undefined') {
      tempWin = installHappyDom();
    }
    composerModulePromise = import('./ComposerDock');
    const module = await composerModulePromise;
    if (tempWin !== null) {
      // lib/api reads window at import time; restore globals but keep the module.
      restoreHappyDom();
    }
    return module;
  }
  return composerModulePromise;
}

const DETACHED =
  'not steerable here · this run was started detached, so its live session is not in this process';

interface SendCall {
  runId: string;
  nodeId: string;
  body: SendWorkflowNodeBody;
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

function okReceipt(messageId: string): SendWorkflowNodeResponse {
  return { success: true, message_id: messageId, state: 'queued' };
}

describe('ComposerDock', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  let composerDock: typeof import('./ComposerDock');
  const calls: SendCall[] = [];
  let nextSend: SendNodeGuidance;

  beforeEach(async () => {
    win = installHappyDom();
    win.sessionStorage.clear();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    composerDock = await loadComposerModule();
    calls.length = 0;
    nextSend = async (runId, nodeId, body): Promise<SendWorkflowNodeResponse> => {
      calls.push({ runId, nodeId, body });
      return okReceipt(body.message_id);
    };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
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

  async function renderDock(
    overrides: Partial<{
      rowStatus: 'pending' | 'running' | 'awaiting' | 'completed' | 'failed' | 'skipped';
      live: boolean;
      hasPendingAsk: boolean;
      send: SendNodeGuidance;
      storage: Storage;
      nodeLabel: string;
    }> = {}
  ): Promise<void> {
    await act(async () => {
      root.render(
        createElement(composerDock.ComposerDock, {
          runId: 'run-1',
          nodeId: 'grp.body',
          nodeLabel: overrides.nodeLabel ?? 'implement',
          rowStatus: overrides.rowStatus ?? 'running',
          live: overrides.live ?? true,
          hasPendingAsk: overrides.hasPendingAsk ?? false,
          send: overrides.send ?? nextSend,
          storage: overrides.storage,
        })
      );
    });
    await flush();
  }

  function field(): HTMLTextAreaElement {
    const el = host.querySelector('textarea');
    if (el === null) throw new Error('missing textarea');
    return el as unknown as HTMLTextAreaElement;
  }

  function queueButton(): HTMLButtonElement {
    const buttons = [...host.querySelectorAll('button')];
    const match = buttons.find(button => (button.textContent ?? '').trim() === 'Queue');
    if (match === undefined) throw new Error('missing Queue button');
    return match as unknown as HTMLButtonElement;
  }

  function reactOnChange(
    node: Element
  ): ((event: { target: { value: string } }) => void) | undefined {
    const fiberKey = Object.keys(node).find(key => key.startsWith('__reactProps$'));
    if (fiberKey === undefined) return undefined;
    return (
      node as unknown as Record<
        string,
        { onChange?: (event: { target: { value: string } }) => void }
      >
    )[fiberKey]?.onChange;
  }

  async function setDraft(value: string): Promise<void> {
    await act(async () => {
      const onChange = reactOnChange(field());
      if (onChange === undefined) throw new Error('missing onChange');
      onChange({ target: { value } });
    });
    await flush();
  }

  async function pressKey(init: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
  }): Promise<void> {
    const event = new win.KeyboardEvent('keydown', {
      key: init.key,
      metaKey: init.metaKey ?? false,
      ctrlKey: init.ctrlKey ?? false,
      shiftKey: init.shiftKey ?? false,
      bubbles: true,
      cancelable: true,
    });
    if (init.isComposing === true) {
      Object.defineProperty(event, 'isComposing', { value: true });
    }
    if (init.keyCode !== undefined) {
      Object.defineProperty(event, 'keyCode', { value: init.keyCode });
    }
    await act(async () => {
      field().dispatchEvent(event as unknown as Event);
    });
    await flush();
  }

  async function clickQueue(): Promise<void> {
    await act(async () => {
      queueButton().click();
    });
    await flush();
  }

  test('generating/empty shows field, hint, and Queue — no band, Stop, or delete', async () => {
    await renderDock();
    const label = host.querySelector('label[for]');
    expect(label?.textContent).toBe('message to implement');
    expect(label?.getAttribute('for')).toBe(field().id);
    expect(host.textContent).toContain('Cmd/Ctrl+Enter to send · this tab only');
    const button = queueButton();
    expect(button.textContent?.trim()).toBe('Queue');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+Enter Control+Enter');
    expect(button.getAttribute('aria-label')?.startsWith('Queue')).toBe(true);
    expect(host.textContent).not.toContain('queued ·');
    expect(host.textContent).not.toContain('Stop');
    expect(host.textContent).not.toContain('sent');
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });

  test('dock chrome carries the visual contract classes', async () => {
    await renderDock();
    const well = field().closest('div');
    expect(well?.className).toContain('bg-surface-elevated');
    expect(well?.className).toContain('border-t');
    expect(field().className).toContain('min-h-[56px]');
    expect(field().className).toContain('bg-surface-inset');
    expect(field().className).toContain('focus-visible:outline-accent-bright');
    const button = queueButton();
    expect(button.className).toContain('min-h-[32px]');
    expect(button.className).toContain('min-w-[84px]');
    expect(button.className).toContain('focus-visible:outline-accent-bright');
    expect(button.className).toContain('motion-reduce:transition-none');
  });

  test.each(['pending', 'completed', 'failed', 'skipped'] as const)(
    'row status %s renders no dock',
    async rowStatus => {
      await renderDock({ rowStatus });
      expect(host.querySelector('textarea')).toBeNull();
      expect(host.querySelector('button')).toBeNull();
      expect(host.textContent ?? '').not.toContain('Queue');
    }
  );

  test('non-live historical execution renders no dock', async () => {
    await renderDock({ live: false });
    expect(host.querySelector('textarea')).toBeNull();
  });

  test('accepted send shows one ordered receipt with visible sent word', async () => {
    await renderDock();
    await setDraft('wrong suite — use -p archon-workflows');
    await clickQueue();
    expect(calls).toHaveLength(1);
    expect(calls[0].runId).toBe('run-1');
    expect(calls[0].nodeId).toBe('grp.body');
    expect(calls[0].body.message).toBe('wrong suite — use -p archon-workflows');
    expect(calls[0].body.intent).toBe('queue');
    expect(calls[0].body.message_id.length).toBeGreaterThan(0);

    expect(host.textContent).toContain('queued · 1');
    const header = [...host.querySelectorAll('h3')].find(el =>
      (el.textContent ?? '').includes('queued · 1')
    );
    expect(header?.className).toContain('uppercase');
    const list = host.querySelector('ul[aria-label="Queued messages, 1"]');
    expect(list).not.toBeNull();
    const items = [...(list?.querySelectorAll('li') ?? [])];
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('wrong suite — use -p archon-workflows');
    expect(items[0].textContent).toContain('sent');
    // The band is never labelled this-tab-only; that scope is the draft's.
    const band = list?.closest('section');
    expect(band?.textContent ?? '').not.toContain('this tab only');

    expect(field().value).toBe('');
    expect((win.document.activeElement as unknown) === field()).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('1 message queued');
  });

  test('two accepted sends keep order and update count wording', async () => {
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await setDraft('second');
    await clickQueue();
    expect(calls).toHaveLength(2);
    expect(calls[0].body.message_id).not.toBe(calls[1].body.message_id);

    const list = host.querySelector('ul[aria-label="Queued messages, 2"]');
    expect(list).not.toBeNull();
    const items = [...(list?.querySelectorAll('li') ?? [])].map(li => li.textContent ?? '');
    expect(items[0]).toContain('first');
    expect(items[1]).toContain('second');
    expect(host.textContent).toContain('queued · 2');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('2 messages queued');

    // The band is a sibling immediately above the dock, outside its padded well.
    const dockWell = field().parentElement;
    const bandSection = list?.closest('section');
    expect(bandSection).not.toBeNull();
    expect(dockWell?.previousElementSibling).toBe(bandSection);
    expect(bandSection?.contains(dockWell ?? null)).toBe(false);
    expect(dockWell?.contains(bandSection ?? null)).toBe(false);
    // The band caps at 33vh and scrolls internally.
    const scroller = bandSection?.querySelector('div');
    expect(scroller?.className).toContain('max-h-[33vh]');
    expect(scroller?.className).toContain('overflow-y-auto');
  });

  test('Cmd+Enter submits; Ctrl+Enter submits a second message', async () => {
    await renderDock();
    await setDraft('via meta');
    await pressKey({ key: 'Enter', metaKey: true });
    expect(calls).toHaveLength(1);
    await setDraft('via ctrl');
    await pressKey({ key: 'Enter', ctrlKey: true });
    expect(calls).toHaveLength(2);
  });

  test('plain Enter and Shift+Enter keep native newline behavior', async () => {
    await renderDock();
    await setDraft('line one');
    await pressKey({ key: 'Enter' });
    await pressKey({ key: 'Enter', shiftKey: true });
    expect(calls).toHaveLength(0);
  });

  test('composing shortcut does nothing', async () => {
    await renderDock();
    await setDraft('ime draft');
    await pressKey({ key: 'Enter', metaKey: true, isComposing: true });
    await pressKey({ key: 'Enter', metaKey: true, keyCode: 229 });
    expect(calls).toHaveLength(0);
  });

  test('blank-only draft is refused locally with no request', async () => {
    await renderDock();
    await setDraft('   \n  ');
    await clickQueue();
    await pressKey({ key: 'Enter', metaKey: true });
    expect(calls).toHaveLength(0);
    expect(field().value).toBe('   \n  ');
  });

  test('non-blank draft is sent verbatim including edge whitespace', async () => {
    await renderDock();
    await setDraft('  padded\n');
    await clickQueue();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.message).toBe('  padded\n');
  });

  test('one in-flight request: a second press during flight does nothing', async () => {
    const pending = deferred<SendWorkflowNodeResponse>();
    nextSend = async (runId, nodeId, body): Promise<SendWorkflowNodeResponse> => {
      calls.push({ runId, nodeId, body });
      return pending.promise;
    };
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await clickQueue();
    await pressKey({ key: 'Enter', metaKey: true });
    expect(calls).toHaveLength(1);
    await act(async () => {
      pending.resolve(okReceipt(calls[0].body.message_id));
    });
    await flush();
    expect(host.textContent).toContain('queued · 1');
  });

  test('ambiguous failure keeps draft and retries with the same id', async () => {
    let attempt = 0;
    const first = deferred<SendWorkflowNodeResponse>();
    const second = deferred<SendWorkflowNodeResponse>();
    nextSend = async (runId, nodeId, body): Promise<SendWorkflowNodeResponse> => {
      calls.push({ runId, nodeId, body });
      attempt += 1;
      return attempt === 1 ? first.promise : second.promise;
    };
    await renderDock();
    await setDraft('retry me');
    await clickQueue();
    await act(async () => {
      first.reject(new TypeError('network lost'));
    });
    await flush();
    expect(field().value).toBe('retry me');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "couldn't send · back in the queue"
    );

    await clickQueue();
    expect(calls).toHaveLength(2);
    expect(calls[1].body.message_id).toBe(calls[0].body.message_id);
    await act(async () => {
      second.resolve(okReceipt(calls[1].body.message_id));
    });
    await flush();
    expect(host.textContent).toContain('queued · 1');
  });

  test('editing the draft after a failure mints a new id', async () => {
    nextSend = async (runId, nodeId, body): Promise<SendWorkflowNodeResponse> => {
      calls.push({ runId, nodeId, body });
      throw new TypeError('offline');
    };
    await renderDock();
    await setDraft('first attempt');
    await clickQueue();
    await setDraft('edited attempt');
    await clickQueue();
    expect(calls).toHaveLength(2);
    expect(calls[1].body.message_id).not.toBe(calls[0].body.message_id);
  });

  test('a replayed 200 never duplicates the local row', async () => {
    nextSend = async (runId, nodeId, body): Promise<SendWorkflowNodeResponse> => {
      calls.push({ runId, nodeId, body });
      return okReceipt('server-fixed-id');
    };
    await renderDock();
    await setDraft('one');
    await clickQueue();
    await setDraft('two');
    await clickQueue();
    const list = host.querySelector('ul[aria-label="Queued messages, 1"]');
    expect(list).not.toBeNull();
    expect(host.querySelectorAll('li')).toHaveLength(1);
  });

  test('a rejected send keeps focus off the document body', async () => {
    nextSend = async (): Promise<SendWorkflowNodeResponse> => {
      throw new SteeringSendError(409, 'node_finished', 'Workflow node is finished');
    };
    await renderDock();
    await setDraft('keep me');
    const button = queueButton();
    await act(async () => {
      button.focus();
    });
    await clickQueue();
    expect(win.document.activeElement).not.toBe(win.document.body);
    expect(field().value).toBe('keep me');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Workflow node is finished');
  });

  test('pending ask blocks send: focusable aria-disabled, reason wired by describedby', async () => {
    await renderDock({ hasPendingAsk: true });
    const button = queueButton();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('disabled')).toBeNull();
    expect(button.className).toContain('text-text-secondary');
    const reasonId = button.getAttribute('aria-describedby');
    expect(reasonId).not.toBeNull();
    const reason = host.querySelector(`#${reasonId ?? ''}`);
    expect(reason?.textContent).toBe("answer the agent's question first");
    expect(reason?.className ?? '').toContain('text-text-secondary');

    await setDraft('still editable');
    await clickQueue();
    await pressKey({ key: 'Enter', metaKey: true });
    expect(calls).toHaveLength(0);
    expect(field().value).toBe('still editable');
  });

  test('awaiting row status blocks with the same reason', async () => {
    await renderDock({ rowStatus: 'awaiting' });
    const button = queueButton();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await clickQueue();
    expect(calls).toHaveLength(0);
    expect(host.textContent).toContain("answer the agent's question first");
  });

  test('422 not_steerable_here replaces the dock with the exact disclosure', async () => {
    nextSend = async (): Promise<SendWorkflowNodeResponse> => {
      throw new SteeringSendError(
        422,
        'not_steerable_here',
        'No live steering session for this node in this process'
      );
    };
    await renderDock();
    await setDraft('kept for later');
    await clickQueue();
    await flush();

    expect(host.textContent).toBe(DETACHED);
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('ul')).toBeNull();

    const stored = win.sessionStorage.getItem('archon:steering-draft:run-1:grp.body');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? '{}') as { draft?: string; pendingRetry?: unknown };
    expect(parsed.draft).toBe('kept for later');
    expect(parsed.pendingRetry).not.toBeNull();
  });

  test('hydrates a persisted draft and clears storage after a success', async () => {
    win.sessionStorage.setItem(
      'archon:steering-draft:run-1:grp.body',
      JSON.stringify({ draft: 'from storage', pendingRetry: null })
    );
    await renderDock();
    expect(field().value).toBe('from storage');
    await clickQueue();
    expect(win.sessionStorage.getItem('archon:steering-draft:run-1:grp.body')).toBeNull();
  });
});
