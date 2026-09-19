process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import { SteeringRequestError, type SteeringSubState } from '@/lib/steering-dock';
import type {
  InterruptNode,
  ReadNodeGuidanceQueue,
  SendNodeGuidance,
  WithdrawNodeGuidance,
} from './ConsoleComposerDock';
import type {
  InterruptWorkflowNodeResponse,
  ReadWorkflowNodeQueueResponse,
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

interface InterruptCall {
  runId: string;
  nodeId: string;
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

function okReceipt(
  messageId: string,
  state: SendWorkflowNodeResponse['state'] = 'queued'
): SendWorkflowNodeResponse {
  return { success: true, message_id: messageId, state };
}

function idleAck(): InterruptWorkflowNodeResponse {
  return { success: true, sub_state: 'idle-after-interrupt' };
}

describe('ConsoleComposerDock', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  let composerDock: typeof import('./ConsoleComposerDock');
  const calls: SendCall[] = [];
  const interruptCalls: InterruptCall[] = [];
  let nextSend: SendNodeGuidance;
  let nextInterrupt: InterruptNode;
  const withdrawCalls: WithdrawCall[] = [];
  let nextWithdraw: WithdrawNodeGuidance;
  const readCalls: { runId: string; nodeId: string; signal?: AbortSignal }[] = [];
  let nextRead: ReadNodeGuidanceQueue;

  beforeEach(async () => {
    win = installHappyDom();
    win.sessionStorage.clear();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    composerDock = await loadComposerModule();
    calls.length = 0;
    interruptCalls.length = 0;
    nextSend = async (runId, nodeId, body): Promise<SendWorkflowNodeResponse> => {
      calls.push({ runId, nodeId, body });
      return okReceipt(
        body.message_id,
        body.intent === 'send_now' ? 'awaiting_send_now' : 'queued'
      );
    };
    nextInterrupt = async (runId, nodeId): Promise<InterruptWorkflowNodeResponse> => {
      interruptCalls.push({ runId, nodeId });
      return idleAck();
    };
    withdrawCalls.length = 0;
    nextWithdraw = async (runId, nodeId, messageId): Promise<WithdrawWorkflowNodeResponse> => {
      withdrawCalls.push({ runId, nodeId, messageId });
      return { success: true, message_id: messageId };
    };
    readCalls.length = 0;
    // Default: a never-settling read so existing send/withdraw tests stay
    // deterministic with no real fetch and no hydration race.
    nextRead = async (runId, nodeId, options): Promise<ReadWorkflowNodeQueueResponse> => {
      readCalls.push({ runId, nodeId, signal: options?.signal });
      return deferred<ReadWorkflowNodeQueueResponse>().promise;
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
      runId: string;
      nodeId: string;
      rowStatus: 'pending' | 'running' | 'awaiting' | 'completed' | 'failed' | 'skipped';
      live: boolean;
      hasPendingAsk: boolean;
      subState: SteeringSubState;
      finishedIteration: { liveRowId: string; liveIteration: number } | null;
      onSelectLiveRow: (liveRowId: string) => void;
      autoFocusTarget: 'field' | 'go' | null;
      onAutoFocusApplied: () => void;
      send: SendNodeGuidance;
      interrupt: InterruptNode;
      withdraw: WithdrawNodeGuidance;
      readQueue: ReadNodeGuidanceQueue;
      pollIntervalMs: number;
      storage: Storage;
      nodeLabel: string;
      focusLastRow: () => void;
    }> = {}
  ): Promise<void> {
    await act(async () => {
      root.render(
        createElement(composerDock.ConsoleComposerDock, {
          runId: overrides.runId ?? 'run-1',
          nodeId: overrides.nodeId ?? 'grp.body',
          nodeLabel: overrides.nodeLabel ?? 'implement',
          rowStatus: overrides.rowStatus ?? 'running',
          live: overrides.live ?? true,
          hasPendingAsk: overrides.hasPendingAsk ?? false,
          subState: overrides.subState,
          finishedIteration: overrides.finishedIteration,
          onSelectLiveRow: overrides.onSelectLiveRow,
          autoFocusTarget: overrides.autoFocusTarget,
          onAutoFocusApplied: overrides.onAutoFocusApplied,
          send: overrides.send ?? nextSend,
          interrupt: overrides.interrupt ?? nextInterrupt,
          withdraw: overrides.withdraw ?? nextWithdraw,
          readQueue: overrides.readQueue ?? nextRead,
          pollIntervalMs: overrides.pollIntervalMs ?? 60_000,
          storage: overrides.storage,
          focusLastRow: overrides.focusLastRow,
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
      throw new SteeringRequestError(
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

  function buttonByText(text: string): HTMLButtonElement {
    const match = [...host.querySelectorAll('button')].find(
      button => (button.textContent ?? '').trim() === text
    );
    if (match === undefined) throw new Error(`missing ${text} button`);
    return match as unknown as HTMLButtonElement;
  }

  function stopButton(): HTMLButtonElement {
    return buttonByText('Stop');
  }

  function sendNowButton(): HTMLButtonElement {
    return buttonByText('Send now');
  }

  async function clickStop(): Promise<void> {
    await act(async () => {
      stopButton().click();
    });
    await flush();
  }

  async function clickSendNow(): Promise<void> {
    await act(async () => {
      sendNowButton().click();
    });
    await flush();
  }

  test('queue-only node (no projected sub-state) shows Queue without Stop', async () => {
    await renderDock();
    expect(queueButton()).not.toBeNull();
    expect(host.textContent).not.toContain('Stop');
    expect(host.textContent).not.toContain('Send now');
  });

  test('generating sub-state shows Stop left of Queue with console ring tokens', async () => {
    await renderDock({ subState: 'generating' });
    const stop = stopButton();
    expect(stop.getAttribute('disabled')).toBeNull();
    expect(stop.className).toContain('min-h-[32px]');
    expect(stop.className).toContain('border-border-bright');
    expect(stop.className).toContain('bg-transparent');
    expect(stop.className).toContain('focus-visible:outline-accent-bright');
    await setDraft('a message enables send');
    const queue = queueButton();
    expect(queue.getAttribute('aria-disabled')).toBeNull();
    expect(queue.className).toContain('border-border-bright');
    expect(queue.className).toContain('bg-transparent');
    const children = [...(stop.parentElement?.children ?? [])];
    expect(children.indexOf(stop)).toBeLessThan(children.indexOf(queue));
  });

  test('Stop resolves idle: one announcement, Send now, disclosure, focus leaves', async () => {
    let focused = 0;
    const focusLastRow = (): void => {
      focused += 1;
      (host.querySelector('textarea') as HTMLElement | null)?.focus();
    };
    await renderDock({ subState: 'generating', focusLastRow });
    const stop = stopButton();
    await act(async () => {
      stop.focus();
    });
    await clickStop();
    expect(interruptCalls).toEqual([{ runId: 'run-1', nodeId: 'grp.body' }]);
    expect(host.textContent).not.toContain('Stop');
    expect(sendNowButton()).not.toBeNull();
    expect(host.textContent).toContain(
      'stopped after the last completed tool call · files already written stay written'
    );
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'agent idle · Send now delivers'
    );
    expect(focused).toBe(1);
    expect(win.document.activeElement).not.toBe(win.document.body);
  });

  test('interrupting keeps Stop focusable with aria-disabled and Queue usable', async () => {
    const pending = deferred<InterruptWorkflowNodeResponse>();
    nextInterrupt = async (runId, nodeId): Promise<InterruptWorkflowNodeResponse> => {
      interruptCalls.push({ runId, nodeId });
      return pending.promise;
    };
    await renderDock({ subState: 'generating' });
    const stop = stopButton();
    await act(async () => {
      stop.focus();
    });
    await clickStop();
    const stopping = buttonByText('Stopping…');
    expect(stopping.getAttribute('aria-disabled')).toBe('true');
    expect(stopping.getAttribute('disabled')).toBeNull();
    expect(stopping.className).toContain('text-text-secondary');
    expect((win.document.activeElement as unknown) === stopping).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('agent interrupting');

    await act(async () => {
      stopping.click();
    });
    await flush();
    expect(interruptCalls).toHaveLength(1);

    await setDraft('wait for send now');
    await clickQueue();
    await pressKey({ key: 'Enter', metaKey: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.intent).toBe('queue');
    expect(host.textContent).toContain('queued · 1');

    await act(async () => {
      pending.resolve(idleAck());
    });
    await flush();
    expect(host.textContent).toContain('will send · 1');
    const list = host.querySelector('ul[aria-label="Will send, 1"]');
    expect(list?.querySelector('li')?.textContent).toContain('wait for send now');
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'agent idle · Send now delivers'
    );
  });

  test('200 generating resolves a spent interrupt without a fake row or Stop loss', async () => {
    nextInterrupt = async (runId, nodeId): Promise<InterruptWorkflowNodeResponse> => {
      interruptCalls.push({ runId, nodeId });
      return { success: true, sub_state: 'generating' };
    };
    await renderDock({ subState: 'generating' });
    await setDraft('queued during the race');
    await clickQueue();
    await clickStop();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'turn ended before stop · 1 sent · agent generating'
    );
    expect(stopButton()).not.toBeNull();
    expect(queueButton()).not.toBeNull();
    expect(host.textContent).toContain('queued · 1');
    expect(host.textContent).not.toContain('interrupted');
  });

  test('interrupt refusals keep the draft: 409 alert, 422 detached, retryable network', async () => {
    nextInterrupt = async (): Promise<InterruptWorkflowNodeResponse> => {
      throw new SteeringRequestError(409, 'node_finished', 'Workflow node is finished');
    };
    await renderDock({ subState: 'generating' });
    await setDraft('kept draft');
    await clickStop();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Workflow node is finished');
    expect(field().value).toBe('kept draft');
    expect(host.textContent).not.toContain('Stopping…');
  });

  test('422 on interrupt uses the existing detached disclosure path', async () => {
    nextInterrupt = async (): Promise<InterruptWorkflowNodeResponse> => {
      throw new SteeringRequestError(
        422,
        'not_steerable_here',
        'No live steering session for this node in this process'
      );
    };
    await renderDock({ subState: 'generating' });
    await clickStop();
    expect(host.textContent).toBe(DETACHED);
    expect(host.querySelector('textarea')).toBeNull();
  });

  test('network interrupt failure returns to generating with a retryable Stop', async () => {
    let attempt = 0;
    nextInterrupt = async (runId, nodeId): Promise<InterruptWorkflowNodeResponse> => {
      interruptCalls.push({ runId, nodeId });
      attempt += 1;
      if (attempt === 1) throw new TypeError('offline');
      return idleAck();
    };
    await renderDock({ subState: 'generating' });
    await clickStop();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "couldn't interrupt · try again"
    );
    expect(stopButton()).not.toBeNull();
    await clickStop();
    expect(interruptCalls).toHaveLength(2);
    expect(sendNowButton()).not.toBeNull();
  });

  test('payload idle state renders Send now without a local click', async () => {
    await renderDock({ subState: 'idle-after-interrupt' });
    expect(host.textContent).not.toContain('Stop');
    expect(sendNowButton()).not.toBeNull();
    expect(host.textContent).toContain(
      'stopped after the last completed tool call · files already written stay written'
    );
    const send = sendNowButton();
    expect(send.getAttribute('aria-label')?.startsWith('Send now')).toBe(true);
    expect(send.getAttribute('aria-label')).toContain('Cmd/Ctrl+Enter to send');
  });

  test('Send now requires a non-blank draft even when receipts exist', async () => {
    nextInterrupt = async (runId, nodeId): Promise<InterruptWorkflowNodeResponse> => {
      interruptCalls.push({ runId, nodeId });
      return idleAck();
    };
    withdrawCalls.length = 0;
    nextWithdraw = async (runId, nodeId, messageId): Promise<WithdrawWorkflowNodeResponse> => {
      withdrawCalls.push({ runId, nodeId, messageId });
      return { success: true, message_id: messageId };
    };
    readCalls.length = 0;
    // Default: a never-settling read so existing send/withdraw tests stay
    // deterministic with no real fetch and no hydration race.
    nextRead = async (runId, nodeId, options): Promise<ReadWorkflowNodeQueueResponse> => {
      readCalls.push({ runId, nodeId, signal: options?.signal });
      return deferred<ReadWorkflowNodeQueueResponse>().promise;
    };
    await renderDock({ subState: 'generating' });
    await setDraft('already queued');
    await clickQueue();
    await clickStop();
    expect(host.textContent).toContain('will send · 1');
    const send = sendNowButton();
    expect(send.getAttribute('aria-disabled')).toBe('true');
    await clickSendNow();
    await pressKey({ key: 'Enter', metaKey: true });
    expect(calls).toHaveLength(1);
  });

  test('Send now posts only the new draft, clears band and draft on success', async () => {
    await renderDock({ subState: 'idle-after-interrupt' });
    await setDraft('redirect the agent');
    await clickSendNow();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.message).toBe('redirect the agent');
    expect(calls[0].body.intent).toBe('send_now');
    expect(field().value).toBe('');
    expect(stopButton()).not.toBeNull();
    expect(queueButton()).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('agent generating');
  });

  test('Send-now failure restores old then new items and keeps the retry id', async () => {
    const first = deferred<SendWorkflowNodeResponse>();
    const second = deferred<SendWorkflowNodeResponse>();
    let attempt = 0;
    nextInterrupt = async (runId, nodeId): Promise<InterruptWorkflowNodeResponse> => {
      interruptCalls.push({ runId, nodeId });
      return idleAck();
    };
    withdrawCalls.length = 0;
    nextWithdraw = async (runId, nodeId, messageId): Promise<WithdrawWorkflowNodeResponse> => {
      withdrawCalls.push({ runId, nodeId, messageId });
      return { success: true, message_id: messageId };
    };
    readCalls.length = 0;
    // Default: a never-settling read so existing send/withdraw tests stay
    // deterministic with no real fetch and no hydration race.
    nextRead = async (runId, nodeId, options): Promise<ReadWorkflowNodeQueueResponse> => {
      readCalls.push({ runId, nodeId, signal: options?.signal });
      return deferred<ReadWorkflowNodeQueueResponse>().promise;
    };
    nextSend = async (runId, nodeId, body): Promise<SendWorkflowNodeResponse> => {
      calls.push({ runId, nodeId, body });
      attempt += 1;
      if (attempt === 3) return first.promise;
      if (attempt === 4) return second.promise;
      return okReceipt(body.message_id);
    };
    await renderDock({ subState: 'generating' });
    await setDraft('queued one');
    await clickQueue();
    await setDraft('queued two');
    await clickQueue();
    await clickStop();
    await setDraft('the redirect');
    await clickSendNow();
    expect(calls[2].body.intent).toBe('send_now');
    expect(host.querySelectorAll('li')).toHaveLength(0);
    await act(async () => {
      first.reject(new TypeError('network lost'));
    });
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "couldn't send · back in the queue"
    );
    const list = host.querySelector('ul[aria-label="Will send, 3"]');
    const items = [...(list?.querySelectorAll('li') ?? [])].map(li => li.textContent ?? '');
    expect(items[0]).toContain('queued one');
    expect(items[1]).toContain('queued two');
    expect(items[2]).toContain('the redirect');
    expect(field().value).toBe('the redirect');

    await clickSendNow();
    expect(calls).toHaveLength(4);
    expect(calls[3].body.message_id).toBe(calls[2].body.message_id);
    await act(async () => {
      second.resolve({
        success: true,
        message_id: calls[3].body.message_id,
        state: 'awaiting_send_now',
      });
    });
    await flush();
    expect(host.querySelectorAll('li')).toHaveLength(0);
    expect(stopButton()).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('agent generating');
  });

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
  function okQueue(rows: { message_id: string; message: string }[]): ReadWorkflowNodeQueueResponse {
    return { success: true, queued: rows };
  }
  function controllableRead(): {
    read: ReadNodeGuidanceQueue;
    resolveNext: (value: ReadWorkflowNodeQueueResponse) => void;
    rejectNext: (reason?: unknown) => void;
    pendingCount: () => number;
  } {
    const pending: ReturnType<typeof deferred<ReadWorkflowNodeQueueResponse>>[] = [];
    const read: ReadNodeGuidanceQueue = async (runId, nodeId, options) => {
      readCalls.push({ runId, nodeId, signal: options?.signal });
      const d = deferred<ReadWorkflowNodeQueueResponse>();
      pending.push(d);
      return d.promise;
    };
    return {
      read,
      resolveNext: (value): void => {
        const d = pending.shift();
        if (d === undefined) throw new Error('no pending read to resolve');
        d.resolve(value);
      },
      rejectNext: (reason): void => {
        const d = pending.shift();
        if (d === undefined) throw new Error('no pending read to reject');
        d.reject(reason);
      },
      pendingCount: (): number => pending.length,
    };
  }

  async function waitForPending(ctrl: { pendingCount: () => number }, min = 1): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (ctrl.pendingCount() >= min) return;
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 2));
      });
      await flush();
    }
    throw new Error(
      `pending read never reached ${String(min)} (have ${String(ctrl.pendingCount())})`
    );
  }
  async function settleSnapshot(
    ctrl: {
      resolveNext: (value: ReadWorkflowNodeQueueResponse) => void;
      pendingCount: () => number;
    },
    value: ReadWorkflowNodeQueueResponse
  ): Promise<void> {
    await waitForPending(ctrl);
    await act(async () => {
      ctrl.resolveNext(value);
    });
    await flush();
  }
  async function settleRejection(
    ctrl: {
      rejectNext: (reason?: unknown) => void;
      pendingCount: () => number;
    },
    reason: unknown
  ): Promise<void> {
    await waitForPending(ctrl);
    await act(async () => {
      ctrl.rejectNext(reason);
    });
    await flush();
  }
  test('a 409 refusal keeps the row and focus on its delete control and shows the alert', async () => {
    nextWithdraw = async (): Promise<WithdrawWorkflowNodeResponse> => {
      throw new SteeringRequestError(409, 'node_finished', 'Workflow node is finished');
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
      throw new SteeringRequestError(
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
  test('empty, generating, and hidden states expose no delete control', async () => {
    await renderDock();
    expect(deleteButtons()).toHaveLength(0);
    await renderDock({ rowStatus: 'completed' });
    expect(deleteButtons()).toHaveLength(0);
    await renderDock({ live: false });
    expect(deleteButtons()).toHaveLength(0);
  });
  test('focused remote removal moves focus next then to textarea, never body', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    await renderDock({ pollIntervalMs: 1, readQueue: ctrl.read });
    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'alpha' },
        { message_id: 'id-b', message: 'beta' },
        { message_id: 'id-c', message: 'gamma' },
      ])
    );

    const firstDelete = deleteButtons()[0];
    await act(async () => {
      firstDelete.focus();
    });
    expect((win.document.activeElement as unknown) === firstDelete).toBe(true);

    // Multi-row removal: drop focused id-a and sibling id-b; skip to id-c.
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-c', message: 'gamma' }]));
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(host.querySelector('li')?.getAttribute('data-message-id')).toBe('id-c');
    expect((win.document.activeElement as unknown) === deleteButtons()[0]).toBe(true);
    expect(win.document.activeElement).not.toBe(win.document.body);

    await act(async () => {
      deleteButtons()[0].focus();
    });
    await settleSnapshot(ctrl, okQueue([]));
    expect(host.querySelector('ul')).toBeNull();
    expect((win.document.activeElement as unknown) === field()).toBe(true);
    expect(win.document.activeElement).not.toBe(win.document.body);
  });
  test('hidden and detached modes never read; detached preserves disclosure', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    await renderDock({ live: false, readQueue: ctrl.read });
    expect(readCalls).toHaveLength(0);
    expect(host.querySelector('textarea')).toBeNull();

    nextSend = async (): Promise<SendWorkflowNodeResponse> => {
      throw new SteeringRequestError(
        422,
        'not_steerable_here',
        'No live steering session for this node in this process'
      );
    };
    await renderDock({ pollIntervalMs: 1, readQueue: ctrl.read });
    const readsBeforeDetach = readCalls.length;
    expect(readsBeforeDetach).toBeGreaterThanOrEqual(1);
    await settleSnapshot(ctrl, okQueue([]));
    await setDraft('kept for later');
    await clickQueue();
    await flush();
    expect(host.textContent).toBe(DETACHED);
    const afterDetach = readCalls.length;

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    await flush();
    expect(readCalls.length).toBe(afterDetach);
    expect(host.textContent).toBe(DETACHED);
  });
  test('hydrates on mount with two rows in exact server order and data-message-id', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    await renderDock({ pollIntervalMs: 60_000, readQueue: ctrl.read });
    expect(readCalls).toHaveLength(1);
    expect(calls).toHaveLength(0);
    expect(withdrawCalls).toHaveLength(0);

    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'alpha' },
        { message_id: 'id-b', message: 'beta' },
      ])
    );

    expect(host.textContent).toContain('queued · 2');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('2 messages queued');
    const list = host.querySelector('ul[aria-label="Queued messages, 2"]');
    expect(list).not.toBeNull();
    const items = [...(list?.querySelectorAll('li') ?? [])];
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('data-message-id')).toBe('id-a');
    expect(items[1].getAttribute('data-message-id')).toBe('id-b');
    expect(items[0].textContent).toContain('alpha');
    expect(items[0].textContent).toContain('sent');
    expect(items[1].textContent).toContain('beta');
    const band = list?.closest('section');
    expect(band?.textContent ?? '').not.toContain('this tab only');
    expect(band?.className).toContain('bg-surface-elevated');
    expect(band?.className).toContain('border-t');
    const scroller = band?.querySelector('div');
    expect(scroller?.className).toContain('max-h-[33vh]');
    expect(scroller?.className).toContain('overflow-y-auto');
    const dockWell = field().parentElement;
    expect(dockWell?.previousElementSibling).toBe(band);
    for (const button of deleteButtons()) {
      expect(button.className).toContain('min-h-[24px]');
      expect(button.className).toContain('min-w-[24px]');
      expect(button.className).toContain('focus-visible:outline-accent-bright');
    }
    expect(calls).toHaveLength(0);
    expect(withdrawCalls).toHaveLength(0);
  });
  test('permanent 409 read stops further reads leaving UI unchanged', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    await renderDock({ pollIntervalMs: 1, readQueue: ctrl.read });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'alpha' }]));

    await settleRejection(ctrl, new SteeringRequestError(409, 'node_finished', 'done'));
    expect(host.querySelector('li')?.getAttribute('data-message-id')).toBe('id-a');
    const afterStop = readCalls.length;
    expect(afterStop).toBeGreaterThanOrEqual(2);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    await flush();
    expect(readCalls.length).toBe(afterStop);
    expect(ctrl.pendingCount()).toBe(0);
  });
  test('remote convergence adds then removes rows without observer DELETE', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    await renderDock({ pollIntervalMs: 1, readQueue: ctrl.read });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'alpha' }]));
    expect(host.querySelectorAll('li')).toHaveLength(1);

    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'alpha' },
        { message_id: 'id-b', message: 'beta' },
      ])
    );
    expect(host.textContent).toContain('queued · 2');
    expect([...host.querySelectorAll('li')].map(li => li.getAttribute('data-message-id'))).toEqual([
      'id-a',
      'id-b',
    ]);

    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-b', message: 'beta' }]));
    expect(host.textContent).toContain('queued · 1');
    expect(host.querySelector('li')?.getAttribute('data-message-id')).toBe('id-b');
    expect(withdrawCalls).toHaveLength(0);
  });
  test('remote snapshot leaves draft, pending retry, and sessionStorage byte-for-byte unchanged', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    const failingSend: SendNodeGuidance = async (runId, nodeId, body) => {
      calls.push({ runId, nodeId, body });
      throw new Error('offline');
    };
    await renderDock({ pollIntervalMs: 1, readQueue: ctrl.read, send: failingSend });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'alpha' }]));
    await setDraft('unsent draft · keep me');
    await clickQueue();
    const before = win.sessionStorage.getItem('archon:steering-draft:run-1:grp.body');
    expect(before).not.toBeNull();
    const beforeRecord = JSON.parse(before ?? '{}') as {
      draft?: string;
      pendingRetry?: { messageId?: string; message?: string } | null;
    };
    expect(beforeRecord.draft).toBe('unsent draft · keep me');
    expect(beforeRecord.pendingRetry?.message).toBe('unsent draft · keep me');
    expect(beforeRecord.pendingRetry?.messageId).toBe(calls[0]?.body.message_id);

    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'alpha' },
        { message_id: 'id-b', message: 'beta' },
      ])
    );
    expect(field().value).toBe('unsent draft · keep me');
    expect(win.sessionStorage.getItem('archon:steering-draft:run-1:grp.body')).toBe(before);
  });
  test('stale read after local send keeps the local row', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    await renderDock({ pollIntervalMs: 1, readQueue: ctrl.read });
    await settleSnapshot(ctrl, okQueue([]));
    await waitForPending(ctrl);

    await setDraft('local only');
    await clickQueue();
    expect(host.querySelector('li')?.textContent).toContain('local only');
    const localId = calls[0].body.message_id;

    // Resolve the pre-send snapshot without the local row — generation guard
    // must keep the local receipt.
    await act(async () => {
      ctrl.resolveNext(okQueue([]));
    });
    await flush();
    expect(host.querySelector('li')?.getAttribute('data-message-id')).toBe(localId);
    expect(host.textContent).toContain('queued · 1');
  });
  test('stale read after local withdraw does not resurrect the row', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    await renderDock({ pollIntervalMs: 1, readQueue: ctrl.read });
    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'alpha' },
        { message_id: 'id-b', message: 'beta' },
      ])
    );
    await waitForPending(ctrl);

    await clickDelete(0);
    expect(withdrawCalls).toHaveLength(1);
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(host.querySelector('li')?.getAttribute('data-message-id')).toBe('id-b');

    await act(async () => {
      ctrl.resolveNext(
        okQueue([
          { message_id: 'id-a', message: 'alpha' },
          { message_id: 'id-b', message: 'beta' },
        ])
      );
    });
    await flush();
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(host.querySelector('li')?.getAttribute('data-message-id')).toBe('id-b');
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
  test('transient 422/0/500 read failures preserve queue+refusal and reschedule', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    await renderDock({ pollIntervalMs: 1, readQueue: ctrl.read });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'alpha' }]));

    // Seed a visible refusal via send failure, then keep it across read errors.
    // Re-render so the dock picks up the failing send prop (props are not live
    // bindings to nextSend).
    const failingSend: SendNodeGuidance = async (): Promise<SendWorkflowNodeResponse> => {
      throw new SteeringRequestError(409, 'node_finished', 'Workflow node is finished');
    };
    await renderDock({ pollIntervalMs: 1, readQueue: ctrl.read, send: failingSend });
    await waitForPending(ctrl);
    await setDraft('keep refusal');
    await clickQueue();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Workflow node is finished');
    expect(host.querySelector('li')?.getAttribute('data-message-id')).toBe('id-a');

    const beforeReads = readCalls.length;
    for (const err of [
      new SteeringRequestError(422, 'not_steerable_here', 'window'),
      new SteeringRequestError(0, null, 'offline'),
      new SteeringRequestError(500, 'internal_error', 'boom'),
    ]) {
      await settleRejection(ctrl, err);
      expect(host.querySelector('li')?.getAttribute('data-message-id')).toBe('id-a');
      expect(host.querySelector('[role="alert"]')?.textContent).toBe('Workflow node is finished');
      expect(host.textContent).not.toBe(DETACHED);
    }
    expect(readCalls.length).toBeGreaterThan(beforeReads);
  });
  test('unmount or scope change with pending read produces no late update', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    await renderDock({ pollIntervalMs: 60_000, readQueue: ctrl.read });
    expect(ctrl.pendingCount()).toBe(1);

    await act(async () => {
      root.unmount();
    });
    await act(async () => {
      ctrl.resolveNext(okQueue([{ message_id: 'id-late', message: 'should not appear' }]));
    });
    await flush();
    expect(host.textContent ?? '').not.toContain('should not appear');

    // Fresh root for scope-change path. Separate readers make it impossible
    // to mistake the new scope's valid hydrate for the old scope's late one.
    root = createRoot(host);
    const oldScope = controllableRead();
    const newScope = controllableRead();
    await renderDock({
      pollIntervalMs: 60_000,
      readQueue: oldScope.read,
      nodeId: 'scope-a',
    });
    expect(oldScope.pendingCount()).toBe(1);
    const oldSignal = readCalls.at(-1)?.signal;
    await renderDock({
      pollIntervalMs: 60_000,
      readQueue: newScope.read,
      nodeId: 'scope-b',
    });
    expect(oldSignal?.aborted).toBe(true);
    expect(newScope.pendingCount()).toBe(1);

    await act(async () => {
      oldScope.resolveNext(okQueue([{ message_id: 'id-stale', message: 'from scope a' }]));
    });
    await flush();
    expect(host.textContent ?? '').not.toContain('from scope a');
    expect(host.querySelector('li')).toBeNull();

    await act(async () => {
      newScope.resolveNext(okQueue([{ message_id: 'id-b', message: 'from scope b' }]));
    });
    await flush();
    expect(host.querySelector('li')?.getAttribute('data-message-id')).toBe('id-b');
    expect(host.textContent ?? '').toContain('from scope b');
  });

  test('finished-iteration renders exact disclosure and Go label', async () => {
    const selected: string[] = [];
    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
      onSelectLiveRow: (id): void => {
        selected.push(id);
      },
    });
    expect(host.textContent).toContain(
      'reading a finished iteration · the agent is working in iteration 3'
    );
    const go = [...host.querySelectorAll('button')].find(
      button => (button.textContent ?? '').trim() === 'Go to iteration 3'
    );
    expect(go).not.toBeUndefined();
    expect(go === undefined ? '' : go.className).toContain('min-h-[32px]');
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent).not.toContain('Cmd/Ctrl+Enter to send');
    expect(
      [...host.querySelectorAll('button')].some(b => (b.textContent ?? '').trim() === 'Queue')
    ).toBe(false);
  });

  test('finished-iteration without onSelectLiveRow renders nothing', async () => {
    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
    });
    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent ?? '').not.toContain('reading a finished iteration');
  });

  test('finished-iteration hydrates ordered band without delete controls', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
      onSelectLiveRow: (): void => undefined,
      pollIntervalMs: 60_000,
      readQueue: ctrl.read,
    });
    expect(readCalls).toHaveLength(1);
    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'alpha' },
        { message_id: 'id-b', message: 'beta' },
      ])
    );
    expect(host.textContent).toContain('queued · 2');
    const list = host.querySelector('ul[aria-label="Queued messages, 2"]');
    expect(list).not.toBeNull();
    const items = [...(list?.querySelectorAll('li') ?? [])];
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute('data-message-id')).toBe('id-a');
    expect(items[1]?.getAttribute('data-message-id')).toBe('id-b');
    expect(items[0]?.textContent).toContain('sent');
    expect(deleteButtons()).toHaveLength(0);
    const scroll = list?.parentElement;
    expect(scroll?.className ?? '').toContain('max-h-[33vh]');
    expect(scroll?.className ?? '').toContain('overflow-y-auto');
  });

  test('finished-iteration empty queue renders no band', async () => {
    const ctrl = controllableRead();
    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
      onSelectLiveRow: (): void => undefined,
      pollIntervalMs: 60_000,
      readQueue: ctrl.read,
    });
    await settleSnapshot(ctrl, okQueue([]));
    expect(host.querySelector('ul')).toBeNull();
    expect(host.textContent ?? '').not.toContain('queued ·');
  });

  test('finished-iteration Go calls parent with liveRowId only', async () => {
    const selected: string[] = [];
    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
      onSelectLiveRow: (id): void => {
        selected.push(id);
      },
    });
    const go = [...host.querySelectorAll('button')].find(
      button => (button.textContent ?? '').trim() === 'Go to iteration 3'
    );
    await act(async () => {
      if (go === undefined) throw new Error('missing Go button');
      go.click();
    });
    await flush();
    expect(selected).toEqual(['occ-live']);
    expect(calls).toHaveLength(0);
    expect(withdrawCalls).toHaveLength(0);
  });

  test('finished-iteration never mutates via pointer or keyboard', async () => {
    const ctrl = controllableRead();
    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
      onSelectLiveRow: (): void => undefined,
      pollIntervalMs: 60_000,
      readQueue: ctrl.read,
    });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'parked' }]));
    await act(async () => {
      host.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
      host.dispatchEvent(
        new win.KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event
      );
    });
    await flush();
    expect(calls).toHaveLength(0);
    expect(withdrawCalls).toHaveLength(0);
    expect(readCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('finished-iteration hides draft and restores it on live return', async () => {
    const storage = win.sessionStorage;
    await renderDock({ storage });
    await setDraft('keep me across finished');
    expect(field().value).toBe('keep me across finished');

    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
      onSelectLiveRow: (): void => undefined,
      storage,
    });
    expect(host.querySelector('textarea')).toBeNull();

    await renderDock({ storage, rowStatus: 'running' });
    expect(field().value).toBe('keep me across finished');
  });

  test('finished-iteration 422 shows detached alert, clears band, keeps polling', async () => {
    const ctrl = controllableRead();
    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
      onSelectLiveRow: (): void => undefined,
      pollIntervalMs: 1,
      readQueue: ctrl.read,
    });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'stale' }]));
    expect(host.textContent).toContain('stale');

    await settleRejection(
      ctrl,
      new SteeringRequestError(422, 'not_steerable_here', 'No live steering session')
    );
    expect(host.textContent).toContain(DETACHED);
    expect(host.textContent ?? '').not.toContain('stale');
    expect(host.querySelector('ul')).toBeNull();
    // Still finished mode — disclosure remains
    expect(host.textContent).toContain('reading a finished iteration');

    await waitForPending(ctrl);
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-b', message: 'restored' }]));
    expect(host.textContent ?? '').not.toContain(DETACHED);
    expect(host.textContent).toContain('restored');
  });

  test('finished-iteration network/5xx keep last snapshot and never show detached', async () => {
    const ctrl = controllableRead();
    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
      onSelectLiveRow: (): void => undefined,
      pollIntervalMs: 1,
      readQueue: ctrl.read,
    });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'kept' }]));
    await settleRejection(ctrl, new SteeringRequestError(0, null, 'network'));
    expect(host.textContent).toContain('kept');
    expect(host.textContent ?? '').not.toContain(DETACHED);
    await settleRejection(ctrl, new SteeringRequestError(503, null, 'unavailable'));
    expect(host.textContent).toContain('kept');
    expect(host.textContent ?? '').not.toContain(DETACHED);
  });

  test('finished-iteration 409 clears snapshot, stops poll, never labeled detached', async () => {
    const ctrl = controllableRead();
    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
      onSelectLiveRow: (): void => undefined,
      pollIntervalMs: 1,
      readQueue: ctrl.read,
    });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'gone' }]));
    const readsBefore = readCalls.length;
    await settleRejection(ctrl, new SteeringRequestError(409, 'run_terminal', 'run ended'));
    expect(host.querySelector('ul')).toBeNull();
    expect(host.textContent ?? '').not.toContain(DETACHED);
    expect(host.textContent).toContain('reading a finished iteration');

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    await flush();
    expect(readCalls.length).toBe(readsBefore + 1);
  });

  test('existing composer/blocked/hidden modes remain unchanged without descriptor', async () => {
    await renderDock({ rowStatus: 'running' });
    expect(host.querySelector('textarea')).not.toBeNull();
    expect(host.textContent).toContain('Cmd/Ctrl+Enter to send');

    await renderDock({ rowStatus: 'awaiting', hasPendingAsk: true });
    expect(host.querySelector('textarea')).not.toBeNull();
    expect(
      [...host.querySelectorAll('button')].some(b => (b.textContent ?? '').trim() === 'Queue')
    ).toBe(true);

    await renderDock({ rowStatus: 'completed' });
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
  });
});
