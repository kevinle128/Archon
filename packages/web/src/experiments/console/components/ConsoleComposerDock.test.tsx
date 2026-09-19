process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import { SteeringSendError } from '@/lib/steering-dock';
import type { SendNodeGuidance, WithdrawNodeGuidance } from './ConsoleComposerDock';
import type {
  SendWorkflowNodeBody,
  SendWorkflowNodeResponse,
  WithdrawWorkflowNodeResponse,
} from '../skills/runs';

const react = await import('react');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

let composerModulePromise: Promise<typeof import('./ConsoleComposerDock')> | null = null;

async function loadComposerModule(): Promise<typeof import('./ConsoleComposerDock')> {
  if (composerModulePromise === null) {
    let tempWin: ReturnType<typeof installHappyDom> | null = null;
    if (typeof globalThis.document === 'undefined') {
      tempWin = installHappyDom();
    }
    composerModulePromise = import('./ConsoleComposerDock');
    const module = await composerModulePromise;
    if (tempWin !== null) {
      // console http reads window at import time; restore globals but keep the module.
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

interface WithdrawCall {
  runId: string;
  nodeId: string;
  messageId: string;
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

describe('ConsoleComposerDock', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  let composerDock: typeof import('./ConsoleComposerDock');
  const calls: SendCall[] = [];
  let nextSend: SendNodeGuidance;
  const withdrawCalls: WithdrawCall[] = [];
  let nextWithdraw: WithdrawNodeGuidance;

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
    withdrawCalls.length = 0;
    nextWithdraw = async (runId, nodeId, messageId): Promise<WithdrawWorkflowNodeResponse> => {
      withdrawCalls.push({ runId, nodeId, messageId });
      return { success: true, message_id: messageId };
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
      withdraw: WithdrawNodeGuidance;
      storage: Storage;
      nodeLabel: string;
    }> = {}
  ): Promise<void> {
    await act(async () => {
      root.render(
        createElement(composerDock.ConsoleComposerDock, {
          runId: 'run-1',
          nodeId: 'grp.body',
          nodeLabel: overrides.nodeLabel ?? 'implement',
          rowStatus: overrides.rowStatus ?? 'running',
          live: overrides.live ?? true,
          hasPendingAsk: overrides.hasPendingAsk ?? false,
          send: overrides.send ?? nextSend,
          withdraw: overrides.withdraw ?? nextWithdraw,
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

  function deleteButtons(): HTMLButtonElement[] {
    return [...host.querySelectorAll('button')].filter(
      button => (button.textContent ?? '').trim() === 'delete'
    ) as unknown as HTMLButtonElement[];
  }

  async function clickDelete(index: number): Promise<void> {
    await act(async () => {
      deleteButtons()[index]?.click();
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
    expect(button.getAttribute('disabled')).toBeNull();
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
    // Solid accent-bright ring — the console-wide accent-ring token (0.3
    // alpha) composites under the 3:1 non-text floor on dock surfaces.
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
    const band = list?.closest('section');
    expect(band?.textContent ?? '').not.toContain('this tab only');

    expect(field().value).toBe('');
    expect((win.document.activeElement as unknown) === field()).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('1 message queued');
  });

  test('two accepted sends keep order; band sits outside the padded dock well', async () => {
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

    const dockWell = field().parentElement;
    const bandSection = list?.closest('section');
    expect(dockWell?.previousElementSibling).toBe(bandSection);
    const scroller = bandSection?.querySelector('div');
    expect(scroller?.className).toContain('max-h-[33vh]');
    expect(scroller?.className).toContain('overflow-y-auto');
  });

  test('Cmd+Enter and Ctrl+Enter submit; plain and Shift+Enter do not', async () => {
    await renderDock();
    await setDraft('via meta');
    await pressKey({ key: 'Enter', metaKey: true });
    expect(calls).toHaveLength(1);
    await setDraft('via ctrl');
    await pressKey({ key: 'Enter', ctrlKey: true });
    expect(calls).toHaveLength(2);
    await pressKey({ key: 'Enter' });
    await pressKey({ key: 'Enter', shiftKey: true });
    expect(calls).toHaveLength(2);
  });

  test('composing shortcut does nothing', async () => {
    await renderDock();
    await setDraft('ime draft');
    await pressKey({ key: 'Enter', metaKey: true, isComposing: true });
    await pressKey({ key: 'Enter', metaKey: true, keyCode: 229 });
    expect(calls).toHaveLength(0);
  });

  test('blank-only draft is refused locally; non-blank whitespace is verbatim', async () => {
    await renderDock();
    await setDraft('   ');
    await clickQueue();
    expect(calls).toHaveLength(0);
    await setDraft('  padded\n');
    await clickQueue();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.message).toBe('  padded\n');
  });

  test('one in-flight request; ambiguous failure retries with the same id', async () => {
    const first = deferred<SendWorkflowNodeResponse>();
    const second = deferred<SendWorkflowNodeResponse>();
    let attempt = 0;
    nextSend = async (runId, nodeId, body): Promise<SendWorkflowNodeResponse> => {
      calls.push({ runId, nodeId, body });
      attempt += 1;
      return attempt === 1 ? first.promise : second.promise;
    };
    await renderDock();
    await setDraft('retry me');
    await clickQueue();
    await clickQueue();
    expect(calls).toHaveLength(1);
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

  test('a successful in-flight send preserves text typed for the next message', async () => {
    const pending = deferred<SendWorkflowNodeResponse>();
    nextSend = async (runId, nodeId, body): Promise<SendWorkflowNodeResponse> => {
      calls.push({ runId, nodeId, body });
      return pending.promise;
    };
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await setDraft('next message');
    await act(async () => {
      pending.resolve(okReceipt(calls[0].body.message_id));
    });
    await flush();

    expect(field().value).toBe('next message');
    expect(host.querySelector('li')?.textContent).toContain('first');
    const stored = win.sessionStorage.getItem('archon:steering-draft:run-1:grp.body');
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ draft: 'next message' });
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
    expect(host.querySelector('ul[aria-label="Queued messages, 1"]')).not.toBeNull();
    expect(host.querySelectorAll('li')).toHaveLength(1);
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
    expect(queueButton().getAttribute('aria-disabled')).toBe('true');
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

    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect((win.document.activeElement as unknown) === alert).toBe(true);

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

  test('each queued row exposes a native delete control named for its message', async () => {
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await setDraft('second');
    await clickQueue();

    const buttons = deleteButtons();
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.textContent?.trim()).toBe('delete');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.className).toContain('min-h-[24px]');
      expect(button.className).toContain('min-w-[24px]');
      // Solid accent-bright ring — the console-wide accent-ring token (0.3
      // alpha) composites under the 3:1 non-text floor on dock surfaces.
      expect(button.className).toContain('focus-visible:outline-accent-bright!');
      expect(button.className).toContain('focus-visible:outline-offset-2');
      expect(button.className).not.toContain('transition');
    }
    expect(buttons[0].getAttribute('aria-label')).toBe('delete · first');
    expect(buttons[1].getAttribute('aria-label')).toBe('delete · second');
  });

  test('clicking a row delete issues exactly one withdraw for run, node, and row id', async () => {
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await setDraft('second');
    await clickQueue();

    await clickDelete(0);
    expect(withdrawCalls).toEqual([
      { runId: 'run-1', nodeId: 'grp.body', messageId: calls[0].body.message_id },
    ]);
  });

  test('a pending withdraw guards every delete while Queue/send stays usable', async () => {
    const pending = deferred<WithdrawWorkflowNodeResponse>();
    nextWithdraw = async (runId, nodeId, messageId): Promise<WithdrawWorkflowNodeResponse> => {
      withdrawCalls.push({ runId, nodeId, messageId });
      return pending.promise;
    };
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await setDraft('second');
    await clickQueue();

    await act(async () => {
      deleteButtons()[0]?.click();
    });
    await flush();
    expect(withdrawCalls).toHaveLength(1);
    for (const button of deleteButtons()) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.getAttribute('disabled')).toBeNull();
    }
    await act(async () => {
      deleteButtons()[1]?.click();
    });
    await flush();
    expect(withdrawCalls).toHaveLength(1);

    await setDraft('third');
    await clickQueue();
    expect(calls).toHaveLength(3);
    expect(host.textContent).toContain('queued · 3');

    await act(async () => {
      pending.resolve({ success: true, message_id: calls[0].body.message_id });
    });
    await flush();
    expect(host.textContent).toContain('queued · 2');
    const items = [...host.querySelectorAll('li')].map(li => li.textContent ?? '');
    expect(items[0]).toContain('second');
    expect(items[1]).toContain('third');
  });

  test('a concurrent send append does not consume focus reserved for withdraw success', async () => {
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await setDraft('second');
    await clickQueue();
    const nextDelete = deleteButtons()[1];

    const pendingSend = deferred<SendWorkflowNodeResponse>();
    const pendingWithdraw = deferred<WithdrawWorkflowNodeResponse>();
    const send: SendNodeGuidance = async (runId, nodeId, body) => {
      calls.push({ runId, nodeId, body });
      return pendingSend.promise;
    };
    const withdraw: WithdrawNodeGuidance = async (runId, nodeId, messageId) => {
      withdrawCalls.push({ runId, nodeId, messageId });
      return pendingWithdraw.promise;
    };
    await renderDock({ send, withdraw });

    await setDraft('third');
    await clickQueue();
    const selectedDelete = deleteButtons()[0];
    await act(async () => {
      selectedDelete.focus();
      selectedDelete.click();
    });
    await flush();

    await act(async () => {
      pendingSend.resolve(okReceipt(calls[2].body.message_id));
    });
    await flush();
    expect(host.textContent).toContain('queued · 3');

    await act(async () => {
      queueButton().focus();
      pendingWithdraw.resolve({ success: true, message_id: calls[0].body.message_id });
    });
    await flush();

    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect((win.document.activeElement as unknown) === nextDelete).toBe(true);
  });

  test('success removes only the selected row, updates wording, and focuses the next delete', async () => {
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await setDraft('second');
    await clickQueue();

    const nextDelete = deleteButtons()[1];
    await clickDelete(0);

    const items = [...host.querySelectorAll('li')];
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('second');
    expect(items[0].textContent).not.toContain('first');
    expect(host.textContent).toContain('queued · 1');
    expect(host.querySelector('ul[aria-label="Queued messages, 1"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('1 message queued');
    expect((win.document.activeElement as unknown) === nextDelete).toBe(true);
  });

  test('deleting the last row focuses the previous delete; deleting the only row focuses the field', async () => {
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await setDraft('second');
    await clickQueue();

    const previousDelete = deleteButtons()[0];
    await clickDelete(1);
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect((win.document.activeElement as unknown) === previousDelete).toBe(true);

    await clickDelete(0);
    expect(host.querySelector('ul')).toBeNull();
    expect(host.textContent).not.toContain('queued ·');
    expect((win.document.activeElement as unknown) === field()).toBe(true);
  });

  test('a 409 refusal keeps the row and focus on its delete control and shows the alert', async () => {
    nextWithdraw = async (): Promise<WithdrawWorkflowNodeResponse> => {
      throw new SteeringSendError(409, 'node_finished', 'Workflow node is finished');
    };
    await renderDock();
    await setDraft('keep me');
    await clickQueue();

    const button = deleteButtons()[0];
    await act(async () => {
      button.focus();
    });
    await act(async () => {
      button.click();
    });
    await flush();

    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Workflow node is finished');
    expect((win.document.activeElement as unknown) === button).toBe(true);
    expect(win.document.activeElement).not.toBe(win.document.body);
  });

  test('a 422 refusal follows the detached disclosure and focuses its alert', async () => {
    nextWithdraw = async (): Promise<WithdrawWorkflowNodeResponse> => {
      throw new SteeringSendError(
        422,
        'not_steerable_here',
        'No live steering session for this node in this process'
      );
    };
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await clickDelete(0);

    expect(host.textContent).toBe(DETACHED);
    expect(host.querySelector('ul')).toBeNull();
    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect((win.document.activeElement as unknown) === alert).toBe(true);
  });

  test('blocked by a pending ask still withdraws and removes the parked item', async () => {
    await renderDock();
    await setDraft('parked one');
    await clickQueue();
    expect(host.querySelectorAll('li')).toHaveLength(1);

    await renderDock({ hasPendingAsk: true });
    expect(queueButton().getAttribute('aria-disabled')).toBe('true');
    await clickQueue();
    expect(calls).toHaveLength(1);

    const buttons = deleteButtons();
    expect(buttons).toHaveLength(1);
    await clickDelete(0);
    expect(withdrawCalls).toEqual([
      { runId: 'run-1', nodeId: 'grp.body', messageId: calls[0].body.message_id },
    ]);
    expect(host.querySelectorAll('li')).toHaveLength(0);
    expect(host.querySelector('ul')).toBeNull();
  });

  test('empty, generating, and hidden states expose no delete control', async () => {
    await renderDock();
    expect(deleteButtons()).toHaveLength(0);
    await renderDock({ rowStatus: 'completed' });
    expect(deleteButtons()).toHaveLength(0);
    await renderDock({ live: false });
    expect(deleteButtons()).toHaveLength(0);
  });
});
