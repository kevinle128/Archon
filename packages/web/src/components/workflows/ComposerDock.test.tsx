process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import { installHappyDom, restoreHappyDom } from '@/experiments/console/test/install-happy-dom';
import type {
  ClearSteeringDraftResponse,
  InterruptWorkflowNodeResponse,
  KeepaliveWorkflowNodeResponse,
  ReadWorkflowNodeQueueResponse,
  SendWorkflowNodeBody,
  SendWorkflowNodeResponse,
  SteeringDraftResponse,
  WithdrawWorkflowNodeResponse,
} from '@/lib/api';
import {
  SteeringRequestError,
  STEERING_DELETE_LABEL,
  type SteeringSubState,
} from '@/lib/steering-dock';
import type {
  ClearNodeDraft,
  InterruptNode,
  KeepaliveNode,
  ReadNodeDraft,
  ReadNodeGuidanceQueue,
  SaveNodeDraft,
  SendNodeGuidance,
  WithdrawNodeGuidance,
} from './ComposerDock';

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

describe('ComposerDock', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  let composerDock: typeof import('./ComposerDock');
  const calls: SendCall[] = [];
  const interruptCalls: InterruptCall[] = [];
  let nextSend: SendNodeGuidance;
  let nextInterrupt: InterruptNode;
  const withdrawCalls: WithdrawCall[] = [];
  let nextWithdraw: WithdrawNodeGuidance;
  const keepaliveCalls: { runId: string; nodeId: string }[] = [];
  let nextKeepalive: KeepaliveNode;
  const readCalls: { runId: string; nodeId: string; signal?: AbortSignal }[] = [];
  let nextRead: ReadNodeGuidanceQueue;
  let nextReadDraft: ReadNodeDraft;
  let nextSaveDraft: SaveNodeDraft;
  let nextClearDraft: ClearNodeDraft;
  // Echoed by the default `nextRead` below so a resolved first read never
  // fights the `subState` PROP a test rendered with — see `renderDock`,
  // which sets this before every render.
  let lastRenderedSubState: SteeringSubState | undefined;
  // Bootstrap-resolve budget shared by every `nextRead` reassignment below
  // (see their own doc comment). `renderDock` resets this to 0 whenever it
  // detects the SAME attempt-reset condition `ComposerDock`'s own effect
  // uses (scope change, `nodeExecutionKey` replaced, or the terminal
  // fail-safe) — each fresh attempt re-enters `firstReadPending` and needs
  // its own two free resolves to escape it, not just the test's very first
  // mount.
  let coldStartResolves = 0;
  let lastScopeKey: string | undefined;
  let lastNodeExecutionKey: string | null | undefined;
  let lastNodeTerminal: boolean | undefined;

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
    keepaliveCalls.length = 0;
    nextKeepalive = async (runId, nodeId): Promise<KeepaliveWorkflowNodeResponse> => {
      keepaliveCalls.push({ runId, nodeId });
      return { success: true };
    };
    readCalls.length = 0;
    coldStartResolves = 0;
    lastScopeKey = undefined;
    lastNodeExecutionKey = undefined;
    lastNodeTerminal = undefined;
    // Default: resolves the bootstrap reads only (the mount tick, plus the
    // one extra tick the poller always fires when that first resolve flips
    // `mode` out of `firstReadPending`'s `hidden` gate — see
    // `settleSnapshot`'s own doc comment on why that second tick exists),
    // echoing whatever `subState` this render was given so the snapshot
    // never fights the same-named PROP most send/withdraw tests set
    // directly (`applyQueueSnapshot` reconciles `sub_state`
    // unconditionally). Every read after that never settles, exactly like
    // the old default — existing send/withdraw tests stay deterministic
    // with no real fetch and no later hydration race clobbering their own
    // optimistic local state.
    nextRead = async (runId, nodeId, options): Promise<ReadWorkflowNodeQueueResponse> => {
      readCalls.push({ runId, nodeId, signal: options?.signal });
      coldStartResolves += 1;
      if (coldStartResolves <= 2) {
        return {
          success: true,
          execution_state: 'live',
          node_outcome: null,
          auto_send: false,
          capabilities: { soft_injection: false, delivery_ack: false },
          queued: [],
          sub_state: lastRenderedSubState ?? null,
        };
      }
      return deferred<ReadWorkflowNodeQueueResponse>().promise;
    };
    // Default: a never-settling draft read (field starts empty, matching the
    // old sessionStorage-empty default) and no-op save/clear.
    nextReadDraft = async (): Promise<SteeringDraftResponse> =>
      deferred<SteeringDraftResponse>().promise;
    nextSaveDraft = async (_runId, _nodeId, body): Promise<SteeringDraftResponse> => ({
      success: true,
      draft: { message: body.message, updated_at: '2026-09-26T00:00:00.000Z' },
      auto_send: false,
    });
    nextClearDraft = async (): Promise<ClearSteeringDraftResponse> => ({ success: true });
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
      onExecutionStateChange: (state: 'live' | 'recovery_required' | 'finished' | null) => void;
      onDeliveryStatesChange: (states: ReadonlyMap<string, string>) => void;
      send: SendNodeGuidance;
      interrupt: InterruptNode;
      withdraw: WithdrawNodeGuidance;
      readQueue: ReadNodeGuidanceQueue;
      readDraft: ReadNodeDraft;
      saveDraft: SaveNodeDraft;
      clearDraft: ClearNodeDraft;
      draftSaveDelayMs: number;
      keepalive: KeepaliveNode;
      pollIntervalMs: number;
      nodeLabel: string;
      focusLastRow: () => void;
      nodeTerminal: boolean;
      nodeExecutionKey: string | null;
      idleAwaitExpired: boolean;
      deliveredMessageIds: ReadonlySet<string>;
      terminalEdgeKick: number;
    }> = {}
  ): Promise<void> {
    lastRenderedSubState = overrides.subState;
    // Mirrors `ComposerDock`'s own attempt-reset conditions (scope change,
    // `nodeExecutionKey` replaced, or the terminal fail-safe) so the
    // bootstrap-resolve budget in the `nextRead` closures above is refreshed
    // exactly when the component's own `dock` state resets to
    // `createSteeringDockState(...)` and re-enters `firstReadPending`.
    const effectiveScopeKey = `${overrides.runId ?? 'run-1'}:${overrides.nodeId ?? 'grp.body'}`;
    const effectiveNodeExecutionKey = overrides.nodeExecutionKey ?? null;
    const effectiveNodeTerminal = overrides.nodeTerminal ?? false;
    const scopeChanged = lastScopeKey !== undefined && lastScopeKey !== effectiveScopeKey;
    const keyReplaced =
      typeof lastNodeExecutionKey === 'string' &&
      typeof effectiveNodeExecutionKey === 'string' &&
      lastNodeExecutionKey !== effectiveNodeExecutionKey;
    const terminalFailSafe =
      lastNodeExecutionKey === null &&
      effectiveNodeExecutionKey === null &&
      lastNodeTerminal === true &&
      !effectiveNodeTerminal;
    if (scopeChanged || keyReplaced || terminalFailSafe) {
      coldStartResolves = 0;
    }
    lastScopeKey = effectiveScopeKey;
    lastNodeExecutionKey = effectiveNodeExecutionKey;
    lastNodeTerminal = effectiveNodeTerminal;
    await act(async () => {
      root.render(
        createElement(composerDock.ComposerDock, {
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
          onExecutionStateChange: overrides.onExecutionStateChange,
          onDeliveryStatesChange: overrides.onDeliveryStatesChange,
          send: overrides.send ?? nextSend,
          interrupt: overrides.interrupt ?? nextInterrupt,
          withdraw: overrides.withdraw ?? nextWithdraw,
          readQueue: overrides.readQueue ?? nextRead,
          readDraft: overrides.readDraft ?? nextReadDraft,
          saveDraft: overrides.saveDraft ?? nextSaveDraft,
          clearDraft: overrides.clearDraft ?? nextClearDraft,
          draftSaveDelayMs: overrides.draftSaveDelayMs ?? 60_000,
          keepalive: overrides.keepalive ?? nextKeepalive,
          pollIntervalMs: overrides.pollIntervalMs ?? 60_000,
          focusLastRow: overrides.focusLastRow,
          nodeTerminal: overrides.nodeTerminal,
          nodeExecutionKey: overrides.nodeExecutionKey,
          idleAwaitExpired: overrides.idleAwaitExpired,
          deliveredMessageIds: overrides.deliveredMessageIds,
          terminalEdgeKick: overrides.terminalEdgeKick,
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
    expect(host.textContent).toContain('Cmd/Ctrl+Enter to send · saved for you');
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

  // Before this dock's own first queue read resolves, a "running" row is
  // indistinguishable from one that actually needs restart recovery — the
  // host's `rowStatus`/`live` say the same thing either way, and
  // `recovery_required` can only ever come from this dock's own read. A
  // live composer shown in that gap would have to be retracted the instant
  // the real answer landed; showing nothing instead is never a retraction.
  test('a cold mount shows no live composer before this dock’s own first read resolves, even for a node that turns out to need restart recovery', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000 });
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(0);

    // The read resolves straight to recovery_required: the dock goes
    // directly from hidden to the read-only restart band, never through a
    // frame with live controls.
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha' }], { execution_state: 'recovery_required' })
    );
    expect(host.textContent).toContain('restored after server restart');
    expect(host.querySelector('textarea')).toBeNull();
  });

  test('an ordinary running node still gets its live composer once this dock’s own first read resolves', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000 });
    expect(host.querySelector('textarea')).toBeNull();
    await settleSnapshot(ctrl, okQueue([]));
    expect(host.querySelector('textarea')).not.toBeNull();
  });

  // Accepted by design: a terminal node's never-sent band is a first paint,
  // not a disappearance — no earlier band existed to keep, so the rule that
  // an undelivered item must never vanish once shown does not apply here.
  // Anchors the current, unchanged behavior.
  test('a terminal node with undelivered items shows no band until this dock’s own first read resolves', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000, nodeTerminal: true });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent ?? '').not.toContain('never sent');

    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha', state: 'never_sent' }], {
        execution_state: 'finished',
      })
    );
    expect(host.textContent).toContain('never sent');
  });

  test('a server-confirmed recovery_required queue read renders a read-only restart band, no controls', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000 });
    await settleSnapshot(ctrl, okQueue([], { execution_state: 'recovery_required' }));
    expect(host.textContent).toContain(
      'restored after server restart · Resume the workflow to continue'
    );
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  test('a non-empty recovery-required band numbers its items but carries no accent', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000 });
    await settleSnapshot(
      ctrl,
      okQueue(
        [
          { message_id: 'id-a', message: 'alpha' },
          { message_id: 'id-b', message: 'beta' },
        ],
        { execution_state: 'recovery_required' }
      )
    );
    const items = [...(host.querySelectorAll('ul[aria-label="Queued messages, 2"] li') ?? [])];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe('1alpha');
    expect(items[1]?.textContent).toBe('2beta');
    // Read-only bands never carry the live "next out" accent.
    expect(items[0]?.className).not.toContain('bg-surface');
    expect(items[0]?.className).toContain('text-text-secondary');
  });

  test('recovery-required survives a queue re-read while the composer stays mounted', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 1 });
    await settleSnapshot(ctrl, okQueue([]));
    expect(host.querySelector('textarea')).not.toBeNull();
    await settleSnapshot(ctrl, okQueue([], { execution_state: 'recovery_required' }));
    expect(host.textContent).toContain('restored after server restart');
    expect(host.querySelector('textarea')).toBeNull();
  });

  // The restart-survivor race: a host page's own, separately-cadenced run
  // read can recover from an outage before this dock's own queue read does,
  // and re-render with a freshly projected `subState` this dock has not
  // itself confirmed. Extends the never-show-controls-this-dock-has-not-read
  // rule from cold mount to this mid-life read-failure gap.
  test('a failed read freezes the projected subState until this dock’s own next read reports recovery_required', async () => {
    const ctrl = controllableRead();
    await renderDock({
      subState: 'idle-after-interrupt',
      pollIntervalMs: 1,
      readQueue: ctrl.read,
    });
    // Pre-outage baseline this dock's own read is driving: a Stopped node
    // shows "Send now", not live Stop/Queue controls.
    await settleSnapshot(ctrl, okQueue([], { sub_state: 'idle-after-interrupt' }));
    expect(host.textContent).not.toContain('Stop');
    expect(sendNowButton()).not.toBeNull();

    // This dock's own next scheduled read fails — the server just went down.
    await settleRejection(ctrl, new SteeringRequestError(0, null, 'network'));

    // The host page's run read recovers first and re-renders with a fresh
    // projection this dock has not itself confirmed.
    await renderDock({
      subState: 'generating',
      pollIntervalMs: 1,
      readQueue: ctrl.read,
    });
    // Still the last-confirmed state — no live "Queue"-only flip.
    expect(host.textContent).not.toContain('Stop');
    expect(sendNowButton()).not.toBeNull();

    // This dock's own next read succeeds and reports the true state.
    await settleSnapshot(
      ctrl,
      okQueue([], { execution_state: 'recovery_required', sub_state: 'generating' })
    );
    expect(host.textContent).toContain('restored after server restart');
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });

  // The other half of the same race, on a live (never-Stopped) node: the run
  // read can lose confidence in the sub-state entirely (an undefined
  // projection, not just a different one) and would otherwise drop Stop
  // while keeping Queue — a live composer degrading into a queue-only one
  // the operator never asked for, still ahead of this dock's own read.
  test('a failed read freezes an undefined projection too, keeping Stop up until recovery_required lands', async () => {
    const ctrl = controllableRead();
    await renderDock({
      subState: 'generating',
      pollIntervalMs: 1,
      readQueue: ctrl.read,
    });
    await settleSnapshot(ctrl, okQueue([], { sub_state: 'generating' }));
    expect(stopButton()).not.toBeNull();

    await settleRejection(ctrl, new SteeringRequestError(0, null, 'network'));

    // The host page's run read recovers first but can no longer say what
    // the agent's sub-state is — an undefined projection, not a defined one.
    await renderDock({
      subState: undefined,
      pollIntervalMs: 1,
      readQueue: ctrl.read,
    });
    // Still the last-confirmed state — Stop has not been dropped.
    expect(stopButton()).not.toBeNull();

    await settleSnapshot(
      ctrl,
      okQueue([], { execution_state: 'recovery_required', sub_state: null })
    );
    expect(host.textContent).toContain('restored after server restart');
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });

  test('reports every observed execution state to the parent, including the initial null', async () => {
    const ctrl = controllableRead();
    const observed: (string | null)[] = [];
    await renderDock({
      readQueue: ctrl.read,
      pollIntervalMs: 60_000,
      onExecutionStateChange: state => {
        observed.push(state);
      },
    });
    expect(observed).toEqual([null]);
    await settleSnapshot(ctrl, okQueue([], { execution_state: 'recovery_required' }));
    expect(observed).toEqual([null, 'recovery_required']);
  });

  test('reports every message id’s delivery state, including rows the pending band drops', async () => {
    const ctrl = controllableRead();
    const observed: ReadonlyMap<string, string>[] = [];
    await renderDock({
      readQueue: ctrl.read,
      pollIntervalMs: 60_000,
      onDeliveryStatesChange: states => {
        observed.push(states);
      },
    });
    expect(observed).toHaveLength(1);
    expect(observed[0]?.size).toBe(0);
    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'a', message: 'alpha', state: 'sent' },
        { message_id: 'b', message: 'beta', state: 'delivered' },
      ])
    );
    expect(observed).toHaveLength(2);
    expect(observed[1]?.get('a')).toBe('sent');
    expect(observed[1]?.get('b')).toBe('delivered');
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

  test('accepted send shows one ordered receipt with no per-item status word while queued', async () => {
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
    const headerLabel = [...host.querySelectorAll('button[aria-expanded] span')].find(
      el => (el.textContent ?? '') === 'queued · 1'
    );
    expect(headerLabel?.className).toContain('uppercase');
    const list = host.querySelector('ul[aria-label="Queued messages, 1"]');
    expect(list).not.toBeNull();
    const items = [...(list?.querySelectorAll('li') ?? [])];
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('wrong suite — use -p archon-workflows');
    expect(items[0].textContent).not.toContain('sent');
    // The band is never labelled saved-for-you; that scope is the draft's.
    const band = list?.closest('section');
    expect(band?.textContent ?? '').not.toContain('saved for you');

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
    const scroller = list?.parentElement;
    expect(scroller?.className).toContain('max-h-[33vh]');
    expect(scroller?.className).toContain('overflow-y-auto');
  });

  test('each queue item leads with its 1-based position number; only the head item carries the accent', async () => {
    await renderDock();
    await setDraft('first');
    await clickQueue();
    await setDraft('second');
    await clickQueue();
    const items = [...(host.querySelectorAll('ul[aria-label="Queued messages, 2"] li') ?? [])];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe(`1first${STEERING_DELETE_LABEL}`);
    expect(items[1]?.textContent).toBe(`2second${STEERING_DELETE_LABEL}`);
    expect(items[0]?.className).toContain('bg-surface');
    expect(items[0]?.className).toContain('text-text-primary');
    expect(items[1]?.className).not.toContain('bg-surface');
    expect(items[1]?.className).toContain('text-text-secondary');
  });

  test('a dispatching item shows its own sending label and is not counted as queued', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000 });
    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'alpha', state: 'queued' },
        { message_id: 'id-b', message: 'beta', state: 'dispatching' },
      ])
    );
    // Two rows total, but only one is genuinely waiting — the header and
    // button both read the count of what is actually queued, not the
    // dispatching item that is already in flight (control-states.md lists
    // queued and dispatching as distinct states).
    expect(host.textContent).toContain('queued · 1');
    expect(host.textContent).not.toContain('queued · 2');
    const list = host.querySelector('ul[aria-label="Queued messages, 1"]');
    expect(list).not.toBeNull();
    const items = [...(list?.querySelectorAll('li') ?? [])];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe(`1alpha${STEERING_DELETE_LABEL}`);
    expect(items[1]?.textContent).toContain('beta');
    expect(items[1]?.textContent).toContain('sending…');
    // Not claimable while dispatching — no withdraw control on this row.
    expect(items[1]?.textContent).not.toContain(STEERING_DELETE_LABEL);
  });

  test('a visible dispatching row with nothing else queued reads sending, never queued · 0', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000 });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'redirect', state: 'dispatching' }])
    );
    expect(host.textContent).toContain('sending · 1');
    expect(host.textContent).not.toContain('queued · 0');
    const list = host.querySelector('ul[aria-label="Sending, 1"]');
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain('sending…');
  });

  test('a dispatching row already delivered to the transcript never shows twice, and the header count agrees', async () => {
    const ctrl = controllableRead();
    await renderDock({
      readQueue: ctrl.read,
      pollIntervalMs: 60_000,
      deliveredMessageIds: new Set(['id-a']),
    });
    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'alpha', state: 'dispatching' },
        { message_id: 'id-b', message: 'beta', state: 'dispatching' },
      ])
    );
    // 'id-a' already landed as a transcript row — the band hides it and the
    // header counts only the one still genuinely in flight, never claiming
    // two are sending while only one row is visible.
    expect(host.textContent).toContain('sending · 1');
    expect(host.textContent).not.toContain('sending · 2');
    expect(host.querySelector('li[data-message-id="id-a"]')).toBeNull();
    const list = host.querySelector('ul[aria-label="Sending, 1"]');
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain('beta');
    expect(list?.textContent).not.toContain('alpha');
  });

  test('a row that advances to sent stays visible as sending… until the transcript confirms it, with no gap and no duplicate', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 1 });
    // Poll 1: still dispatching.
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha', state: 'dispatching' }])
    );
    expect(host.textContent).toContain('sending · 1');

    // Poll 2: the server already advanced the claim to `sent`, but the
    // transcript's own, independently-cadenced fetch has not rendered the
    // matching operator row yet (`deliveredMessageIds` still excludes it).
    // The row must not vanish here — nothing would be shown for the message
    // at all.
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'alpha', state: 'sent' }]));
    expect(host.textContent).toContain('sending · 1');
    expect(host.querySelector('li[data-message-id="id-a"]')).not.toBeNull();

    // The transcript catches up — re-render with the id now delivered. The
    // band hides its row the same render the transcript shows it: no gap,
    // and never both at once.
    await renderDock({
      readQueue: ctrl.read,
      pollIntervalMs: 1,
      deliveredMessageIds: new Set(['id-a']),
    });
    expect(host.querySelector('li[data-message-id="id-a"]')).toBeNull();
    expect(host.textContent).not.toContain('sending · 1');
  });

  test('a sent row this tab never tracked as open is not resurrected into the band', async () => {
    // A cold-loaded or unrelated `sent` row (e.g. a different live
    // iteration's message) must never appear as a phantom "sending…" row.
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000 });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'alpha', state: 'sent' }]));
    expect(host.querySelector('li[data-message-id="id-a"]')).toBeNull();
    expect(host.textContent).not.toContain('sending');
  });

  test('the band collapse toggle hides and restores the item list without removing it', async () => {
    await renderDock();
    await setDraft('wrong suite');
    await clickQueue();
    const toggle = host.querySelector('button[aria-expanded]');
    if (toggle === null) throw new Error('missing band toggle');
    // Open by default, matching the approved mockup.
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const bodyId = toggle.getAttribute('aria-controls');
    if (bodyId === null) throw new Error('missing aria-controls');
    const body = win.document.getElementById(bodyId);
    expect(body?.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('ul[aria-label="Queued messages, 1"]')).not.toBeNull();

    await act(async () => {
      (toggle as unknown as HTMLButtonElement).click();
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body?.hasAttribute('hidden')).toBe(true);
    // The list stays in the DOM — collapsing is a display state, not a removal.
    expect(host.querySelector('ul[aria-label="Queued messages, 1"]')).not.toBeNull();

    await act(async () => {
      (toggle as unknown as HTMLButtonElement).click();
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body?.hasAttribute('hidden')).toBe(false);
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
      throw new SteeringRequestError(409, 'node_finished', 'Workflow node is finished');
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
  });

  test('hydrates a server draft and clears it on a successful send', async () => {
    let cleared = 0;
    const draft = draftReader('from server');
    const clear = clearDraftSpy(() => {
      cleared++;
    });
    await renderDock({ readDraft: draft.read, clearDraft: clear.clear });
    await draft.settle();
    expect(field().value).toBe('from server');
    await clickQueue();
    expect(cleared).toBe(1);
  });

  test('typing debounces a server draft save', async () => {
    const saved: string[] = [];
    const save = saveDraftSpy(message => {
      saved.push(message);
    });
    const draft = draftReader(null);
    await renderDock({ readDraft: draft.read, saveDraft: save.save, draftSaveDelayMs: 5 });
    await draft.settle();
    await setDraft('typed text');
    expect(saved).toHaveLength(0);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    await flush();
    expect(saved).toEqual(['typed text']);
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

  test('generating sub-state shows Stop left of Queue', async () => {
    await renderDock({ subState: 'generating' });
    const stop = stopButton();
    expect(stop.getAttribute('disabled')).toBeNull();
    expect(stop.className).toContain('min-h-[32px]');
    expect(stop.className).toContain('border-border-bright');
    expect(stop.className).toContain('bg-transparent');
    await setDraft('a message enables send');
    const queue = queueButton();
    expect(queue.getAttribute('aria-disabled')).toBeNull();
    expect(queue.className).toContain('border-border-bright');
    expect(queue.className).toContain('bg-transparent');
    const row = stop.parentElement;
    expect(row).not.toBeNull();
    const children = [...(row?.children ?? [])];
    expect(children.indexOf(stop)).toBeLessThan(children.indexOf(queue));
  });

  test('the queue poll corrects Stop/Send now even when the projected subState prop never changes', async () => {
    const ctrl = controllableRead();
    await renderDock({
      subState: 'idle-after-interrupt',
      pollIntervalMs: 1,
      readQueue: ctrl.read,
    });
    // First read matches the projected prop — establishes the baseline this
    // dock's OWN read, not the prop, is now driving. A short interval so
    // the second, real poll tick this test needs arrives quickly.
    await settleSnapshot(ctrl, okQueue([], { sub_state: 'idle-after-interrupt' }));
    expect(host.textContent).not.toContain('Stop');
    expect(sendNowButton()).not.toBeNull();

    // The prop reflects a stale projection this tab's own render never sees
    // update — the same shape as a parent whose separate, slower poll
    // sampled the same value on both sides of a transition another shell
    // caused. The dock's own queue poll must still self-heal.
    await settleSnapshot(ctrl, okQueue([], { sub_state: 'generating' }));

    expect(stopButton()).not.toBeNull();
    expect(host.textContent).not.toContain('Send now');
  });

  test('Stop resolves idle: Stopping… transient, one announcement, focus leaves the dock', async () => {
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

    // Repeated presses are suppressed — only one request is in flight.
    await act(async () => {
      stopping.click();
    });
    await flush();
    expect(interruptCalls).toHaveLength(1);

    // Queue stays usable on click and keyboard while the interrupt is pending.
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
    expect(list).not.toBeNull();
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

  test('409 node_finished clears the transient, keeps the draft, alerts', async () => {
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
    expect(host.textContent).not.toContain('Stopping…');
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

  test('a retryable dispatch failure shows one assertive error naming the evidence, not the generic Stop disclosure', async () => {
    const ctrl = controllableRead();
    await renderDock({
      readQueue: ctrl.read,
      pollIntervalMs: 60_000,
      subState: 'idle-after-interrupt',
    });
    await settleSnapshot(
      ctrl,
      okQueue(
        [
          {
            message_id: 'id-a',
            message: 'redirect',
            state: 'queued',
            last_error: 'provider startup boom',
            dispatch_failure_count: 1,
          },
        ],
        { sub_state: 'idle-after-interrupt' }
      )
    );
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
    expect(alert?.textContent).toBe(
      'automatic dispatch failed · provider startup boom · Send now to retry'
    );
    expect(host.textContent).not.toContain('stopped after the last completed tool call');
    // The idle-await inactivity disclosure still applies unchanged.
    expect(host.textContent).toContain('no redirect ends this node after 30 min of inactivity');
    const row = host.querySelector('li[data-message-id="id-a"]');
    expect(row?.textContent).toContain('failed');
    expect(sendNowButton()).not.toBeNull();
  });

  // An operator's own Send now retry can fail again (same bad text, a
  // still-unreachable provider) — the alert must name THAT attempt, never
  // fall back to claiming it was automatic.
  test('a retryable dispatch failure from an operator Send now retry names Send now, not automatic', async () => {
    const ctrl = controllableRead();
    await renderDock({
      readQueue: ctrl.read,
      pollIntervalMs: 60_000,
      subState: 'idle-after-interrupt',
    });
    await settleSnapshot(
      ctrl,
      okQueue(
        [
          {
            message_id: 'id-a',
            message: 'redirect',
            state: 'queued',
            last_error: 'provider startup boom',
            dispatch_failure_count: 2,
            last_failure_kind: 'send_now',
          },
        ],
        { sub_state: 'idle-after-interrupt' }
      )
    );
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
    expect(alert?.textContent).toBe('Send now failed · provider startup boom · Send now to retry');
  });

  test('an observer sees a durably-queued row stop offering withdraw the instant the projected sub-state advances past it, ahead of its own next poll', async () => {
    // Simulates the observer shell: it learns `idle-after-interrupt` →
    // `generating` from a faster external signal (a host prop backed by
    // SSE/a separate poll) than its own queue poll, which has not yet
    // re-read the item's now-`dispatching` server state. The row must stop
    // offering withdraw and the header must read `sending…`, not `queued`,
    // the instant the projection advances — never a window where the two
    // disagree.
    const ctrl = controllableRead();
    await renderDock({
      readQueue: ctrl.read,
      pollIntervalMs: 60_000,
      subState: 'idle-after-interrupt',
    });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'redirect', state: 'awaiting_send_now' }], {
        sub_state: 'idle-after-interrupt',
      })
    );
    expect(host.textContent).toContain('will send · 1');
    expect(host.querySelector('li[data-message-id="id-a"] button')?.textContent).toBe(
      STEERING_DELETE_LABEL
    );

    // The other shell's Send now lands: this tab's own poll has not fired
    // again, but its projected sub-state prop already reads `generating`.
    await renderDock({
      readQueue: ctrl.read,
      pollIntervalMs: 60_000,
      subState: 'generating',
    });
    expect(host.textContent).toContain('sending · 1');
    expect(host.textContent).not.toContain('queued · 1');
    expect(host.textContent).not.toContain('will send · 1');
    const row = host.querySelector('li[data-message-id="id-a"]');
    expect(row?.textContent).not.toContain(STEERING_DELETE_LABEL);
    expect(row?.textContent).toContain('sending…');
  });

  test('idle with receipts shows will send band and labelled list', async () => {
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
    coldStartResolves = 0;
    lastScopeKey = undefined;
    lastNodeExecutionKey = undefined;
    lastNodeTerminal = undefined;
    // Default: resolves the bootstrap reads only (the mount tick, plus the
    // one extra tick the poller always fires when that first resolve flips
    // `mode` out of `firstReadPending`'s `hidden` gate — see
    // `settleSnapshot`'s own doc comment on why that second tick exists),
    // echoing whatever `subState` this render was given so the snapshot
    // never fights the same-named PROP most send/withdraw tests set
    // directly (`applyQueueSnapshot` reconciles `sub_state`
    // unconditionally). Every read after that never settles, exactly like
    // the old default — existing send/withdraw tests stay deterministic
    // with no real fetch and no later hydration race clobbering their own
    // optimistic local state.
    nextRead = async (runId, nodeId, options): Promise<ReadWorkflowNodeQueueResponse> => {
      readCalls.push({ runId, nodeId, signal: options?.signal });
      coldStartResolves += 1;
      if (coldStartResolves <= 2) {
        return {
          success: true,
          execution_state: 'live',
          node_outcome: null,
          auto_send: false,
          capabilities: { soft_injection: false, delivery_ack: false },
          queued: [],
          sub_state: lastRenderedSubState ?? null,
        };
      }
      return deferred<ReadWorkflowNodeQueueResponse>().promise;
    };
    await renderDock({ subState: 'generating' });
    await setDraft('one');
    await clickQueue();
    await setDraft('two');
    await clickQueue();
    await clickStop();
    expect(host.textContent).toContain('will send · 2');
    const list = host.querySelector('ul[aria-label="Will send, 2"]');
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll('li')).toHaveLength(2);
  });

  test('Send now stays disabled on a blank draft with nothing waiting', async () => {
    await renderDock({ subState: 'idle-after-interrupt' });
    const send = sendNowButton();
    expect(send.getAttribute('aria-disabled')).toBe('true');
    await clickSendNow();
    await pressKey({ key: 'Enter', metaKey: true });
    expect(calls).toHaveLength(0);
  });

  test('Send now with a blank draft delivers everything already waiting (CAP-10)', async () => {
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
    coldStartResolves = 0;
    lastScopeKey = undefined;
    lastNodeExecutionKey = undefined;
    lastNodeTerminal = undefined;
    // Default: resolves the bootstrap reads only (the mount tick, plus the
    // one extra tick the poller always fires when that first resolve flips
    // `mode` out of `firstReadPending`'s `hidden` gate — see
    // `settleSnapshot`'s own doc comment on why that second tick exists),
    // echoing whatever `subState` this render was given so the snapshot
    // never fights the same-named PROP most send/withdraw tests set
    // directly (`applyQueueSnapshot` reconciles `sub_state`
    // unconditionally). Every read after that never settles, exactly like
    // the old default — existing send/withdraw tests stay deterministic
    // with no real fetch and no later hydration race clobbering their own
    // optimistic local state.
    nextRead = async (runId, nodeId, options): Promise<ReadWorkflowNodeQueueResponse> => {
      readCalls.push({ runId, nodeId, signal: options?.signal });
      coldStartResolves += 1;
      if (coldStartResolves <= 2) {
        return {
          success: true,
          execution_state: 'live',
          node_outcome: null,
          auto_send: false,
          capabilities: { soft_injection: false, delivery_ack: false },
          queued: [],
          sub_state: lastRenderedSubState ?? null,
        };
      }
      return deferred<ReadWorkflowNodeQueueResponse>().promise;
    };
    await renderDock({ subState: 'generating' });
    await setDraft('already queued');
    await clickQueue();
    await clickStop();
    expect(host.textContent).toContain('will send · 1');
    const send = sendNowButton();
    expect(send.getAttribute('aria-disabled')).toBeNull();
    const callsBeforeSendNow = calls.length;
    await clickSendNow();
    expect(calls).toHaveLength(callsBeforeSendNow + 1);
    const sendNowCall = calls[callsBeforeSendNow];
    expect(sendNowCall?.body.message).toBe('');
    expect(sendNowCall?.body.intent).toBe('send_now');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('agent generating');
  });

  // A reply that ends the node in the same turn is otherwise only learned on
  // this dock's own next scheduled poll — up to `pollIntervalMs` later. The
  // poll interval here is set far beyond this test's own flush window, so a
  // second read can only appear via the forced kick, never the interval
  // itself firing early.
  test('a successful Send now forces an immediate re-read, never waiting out the poll interval', async () => {
    readCalls.length = 0;
    await renderDock({ subState: 'idle-after-interrupt', pollIntervalMs: 60_000 });
    expect(readCalls.length).toBeGreaterThan(0);
    const readsBeforeSendNow = readCalls.length;
    await setDraft('go ahead');
    await clickSendNow();
    expect(readCalls.length).toBeGreaterThan(readsBeforeSendNow);
  });

  // The host's own faster-than-this-dock's-poll signal (a `dag_node`/
  // `workflow_status` event on the `__dashboard__` stream) forces an
  // immediate re-read on the exact edge it fires, mirroring the Send-now
  // kick above but driven externally. `terminalEdgeKick` can already be
  // non-zero at mount (the host owns the counter) — only a CHANGE counts.
  test('an external terminalEdgeKick forces an immediate re-read on change, never on its initial value', async () => {
    readCalls.length = 0;
    await renderDock({ pollIntervalMs: 60_000, terminalEdgeKick: 5 });
    // Mount itself can already settle at more than one read (the first-ever
    // read exits `firstReadPending`'s hidden gate, and that mode change
    // ticks once more on its own — see `settleSnapshot`'s own doc comment).
    // What this test asserts is the DELTA a `terminalEdgeKick` change
    // causes, not the exact count mount happens to settle at.
    const readsAfterMount = readCalls.length;
    expect(readsAfterMount).toBeGreaterThan(0);

    // Re-render with the same value: no extra read.
    await renderDock({ pollIntervalMs: 60_000, terminalEdgeKick: 5 });
    expect(readCalls.length).toBe(readsAfterMount);

    // The edge fires: an immediate re-read, without waiting the 60s interval.
    await renderDock({ pollIntervalMs: 60_000, terminalEdgeKick: 6 });
    expect(readCalls.length).toBeGreaterThan(readsAfterMount);
  });

  test('Send now posts only the new draft, clears band and draft on success', async () => {
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
    coldStartResolves = 0;
    lastScopeKey = undefined;
    lastNodeExecutionKey = undefined;
    lastNodeTerminal = undefined;
    // Default: resolves the bootstrap reads only (the mount tick, plus the
    // one extra tick the poller always fires when that first resolve flips
    // `mode` out of `firstReadPending`'s `hidden` gate — see
    // `settleSnapshot`'s own doc comment on why that second tick exists),
    // echoing whatever `subState` this render was given so the snapshot
    // never fights the same-named PROP most send/withdraw tests set
    // directly (`applyQueueSnapshot` reconciles `sub_state`
    // unconditionally). Every read after that never settles, exactly like
    // the old default — existing send/withdraw tests stay deterministic
    // with no real fetch and no later hydration race clobbering their own
    // optimistic local state.
    nextRead = async (runId, nodeId, options): Promise<ReadWorkflowNodeQueueResponse> => {
      readCalls.push({ runId, nodeId, signal: options?.signal });
      coldStartResolves += 1;
      if (coldStartResolves <= 2) {
        return {
          success: true,
          execution_state: 'live',
          node_outcome: null,
          auto_send: false,
          capabilities: { soft_injection: false, delivery_ack: false },
          queued: [],
          sub_state: lastRenderedSubState ?? null,
        };
      }
      return deferred<ReadWorkflowNodeQueueResponse>().promise;
    };
    await renderDock({ subState: 'generating' });
    await setDraft('already queued');
    await clickQueue();
    await clickStop();
    await setDraft('redirect the agent');
    await clickSendNow();
    expect(calls).toHaveLength(2);
    expect(calls[1].body.message).toBe('redirect the agent');
    expect(calls[1].body.intent).toBe('send_now');
    expect(calls[1].body.message_id.length).toBeGreaterThan(0);
    // The in-flight band shows both items as an optimistic `sending…` row
    // each, rather than sitting empty until the next queue poll.
    expect(host.textContent).not.toContain('will send ·');
    expect(host.textContent).not.toContain('queued ·');
    expect(host.textContent).toContain('sending · 2');
    expect([...host.querySelectorAll('li')].map(li => li.textContent)).toEqual([
      expect.stringContaining('sending…'),
      expect.stringContaining('sending…'),
    ]);
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
    coldStartResolves = 0;
    lastScopeKey = undefined;
    lastNodeExecutionKey = undefined;
    lastNodeTerminal = undefined;
    // Default: resolves the bootstrap reads only (the mount tick, plus the
    // one extra tick the poller always fires when that first resolve flips
    // `mode` out of `firstReadPending`'s `hidden` gate — see
    // `settleSnapshot`'s own doc comment on why that second tick exists),
    // echoing whatever `subState` this render was given so the snapshot
    // never fights the same-named PROP most send/withdraw tests set
    // directly (`applyQueueSnapshot` reconciles `sub_state`
    // unconditionally). Every read after that never settles, exactly like
    // the old default — existing send/withdraw tests stay deterministic
    // with no real fetch and no later hydration race clobbering their own
    // optimistic local state.
    nextRead = async (runId, nodeId, options): Promise<ReadWorkflowNodeQueueResponse> => {
      readCalls.push({ runId, nodeId, signal: options?.signal });
      coldStartResolves += 1;
      if (coldStartResolves <= 2) {
        return {
          success: true,
          execution_state: 'live',
          node_outcome: null,
          auto_send: false,
          capabilities: { soft_injection: false, delivery_ack: false },
          queued: [],
          sub_state: lastRenderedSubState ?? null,
        };
      }
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
    // The batch renders as an optimistic `dispatching` row in the SAME
    // state update as the click — never a render with neither the queued
    // items nor a sending row.
    const sendingList = host.querySelector('ul[aria-label="Sending, 3"]');
    expect(sendingList).not.toBeNull();
    expect(sendingList?.querySelectorAll('li')).toHaveLength(3);
    await act(async () => {
      first.reject(new TypeError('network lost'));
    });
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "couldn't send · back in the queue"
    );
    const list = host.querySelector('ul[aria-label="Will send, 3"]');
    expect(list).not.toBeNull();
    const items = [...(list?.querySelectorAll('li') ?? [])].map(li => li.textContent ?? '');
    expect(items[0]).toContain('queued one');
    expect(items[1]).toContain('queued two');
    expect(items[2]).toContain('the redirect');
    expect(field().value).toBe('the redirect');

    // Retry reposts only the same new id — prior receipts are never re-sent.
    await clickSendNow();
    expect(calls).toHaveLength(4);
    expect(calls[3].body.message_id).toBe(calls[2].body.message_id);
    expect(calls[3].body.intent).toBe('send_now');
    await act(async () => {
      second.resolve({
        success: true,
        message_id: calls[3].body.message_id,
        state: 'awaiting_send_now',
      });
    });
    await flush();
    // The whole retried batch shows as optimistic `sending…` rows rather
    // than sitting empty until the next queue poll.
    expect(host.textContent).toContain('sending · 3');
    expect([...host.querySelectorAll('li')].map(li => li.textContent)).toEqual([
      expect.stringContaining('sending…'),
      expect.stringContaining('sending…'),
      expect.stringContaining('sending…'),
    ]);
    expect(stopButton()).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('agent generating');
  });

  function deleteButtons(): HTMLButtonElement[] {
    return [...host.querySelectorAll('button')].filter(button =>
      (button.getAttribute('aria-label') ?? '').startsWith('delete · ')
    ) as unknown as HTMLButtonElement[];
  }
  async function clickDelete(index: number): Promise<void> {
    await act(async () => {
      deleteButtons()[index]?.click();
    });
    await flush();
  }
  function okQueue(
    rows: {
      message_id: string;
      message: string;
      operator_user_id?: string | null;
      state?: ReadWorkflowNodeQueueResponse['queued'][number]['state'];
      last_error?: string | null;
      dispatch_failure_count?: number;
      last_failure_kind?: 'automatic' | 'send_now' | null;
    }[],
    overrides?: Partial<Omit<ReadWorkflowNodeQueueResponse, 'success' | 'queued'>>
  ): ReadWorkflowNodeQueueResponse {
    return {
      success: true,
      execution_state: overrides?.execution_state ?? 'live',
      node_outcome: overrides?.node_outcome ?? null,
      auto_send: overrides?.auto_send ?? false,
      capabilities: overrides?.capabilities ?? { soft_injection: false, delivery_ack: false },
      queued: rows.map(row => ({
        message_id: row.message_id,
        message: row.message,
        operator_user_id: row.operator_user_id ?? null,
        state: row.state ?? 'queued',
        last_error: row.last_error ?? null,
        dispatch_failure_count: row.dispatch_failure_count ?? 0,
        last_failure_kind: row.last_failure_kind ?? null,
      })),
      sub_state: overrides?.sub_state ?? null,
    };
  }

  /**
   * A controllable `readDraft` mock: returns a never-settling promise until
   * `settle()` resolves it with the given draft text (or null for none).
   */
  function draftReader(message: string | null): {
    read: ReadNodeDraft;
    settle: () => Promise<void>;
  } {
    const pending: ReturnType<typeof deferred<SteeringDraftResponse>>[] = [];
    const read: ReadNodeDraft = async () => {
      const d = deferred<SteeringDraftResponse>();
      pending.push(d);
      return d.promise;
    };
    return {
      read,
      settle: async (): Promise<void> => {
        await waitForPending({ pendingCount: () => pending.length });
        const d = pending.shift();
        d?.resolve({
          success: true,
          draft: message === null ? null : { message, updated_at: '2026-09-26T00:00:00.000Z' },
          auto_send: false,
        });
        await flush();
      },
    };
  }

  /** A `clearDraft`-shaped spy that resolves immediately and records calls. */
  function clearDraftSpy(onCall: () => void): { clear: ClearNodeDraft } {
    return {
      clear: async (): Promise<ClearSteeringDraftResponse> => {
        onCall();
        return { success: true };
      },
    };
  }

  /** A `saveDraft`-shaped spy that resolves immediately and records calls. */
  function saveDraftSpy(onCall: (message: string) => void): { save: SaveNodeDraft } {
    return {
      save: async (_runId, _nodeId, body): Promise<SteeringDraftResponse> => {
        onCall(body.message);
        return {
          success: true,
          draft: { message: body.message, updated_at: '2026-09-26T00:00:00.000Z' },
          auto_send: false,
        };
      },
    };
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
  // Tracks which `controllableRead()` instances have already had their
  // bootstrap settle drained — see `settleSnapshot` below. Never cleared:
  // each test's `controllableRead()` call returns a fresh object, so old
  // entries are simply unreachable once that object is, with no cross-test
  // leakage risk.
  const bootstrapDrainedCtrls = new WeakSet();

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
    // Only the FIRST-EVER settle against a given controllable read can be
    // the one that exits `firstReadPending`'s `hidden` gate — that
    // transition always ticks the poller once more immediately (the same
    // cleanup+restart-on-`mode`-change mechanism the terminal-edge kick
    // relies on), so one redundant read can already be pending again
    // right after. Draining it with the SAME value is a no-op on dock state
    // (nothing changed since), so the caller sees exactly the transition it
    // asked for. Scoped to the first call only: a LATER settle's own extra
    // pending read (e.g. a second, genuinely independent fetch a terminal
    // transition triggers) is for the caller's own next explicit settle,
    // not something to silently swallow here.
    if (!bootstrapDrainedCtrls.has(ctrl)) {
      bootstrapDrainedCtrls.add(ctrl);
      if (ctrl.pendingCount() > 0) {
        await act(async () => {
          ctrl.resolveNext(value);
        });
        await flush();
      }
    }
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

    const ctrl = controllableRead();
    await renderDock({ hasPendingAsk: true, readQueue: ctrl.read });
    // The new poller fires its own read immediately on mount — drain it
    // (reflecting the still-queued item) so only the withdraw's own kicked
    // re-read is pending by the time the delete below settles one.
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: calls[0].body.message_id, message: 'parked one', state: 'queued' }])
    );
    expect(queueButton().getAttribute('aria-disabled')).toBe('true');
    await clickQueue();
    expect(calls).toHaveLength(1);

    const buttons = deleteButtons();
    expect(buttons).toHaveLength(1);
    await clickDelete(0);
    expect(withdrawCalls).toEqual([
      { runId: 'run-1', nodeId: 'grp.body', messageId: calls[0].body.message_id },
    ]);
    // Withdrawing the only row defers the actual removal to the kicked
    // re-read (the withdraw response never says whether it landed) — the
    // row stays rendered, never a blank band, until that read confirms it.
    expect(host.querySelectorAll('li')).toHaveLength(1);

    await settleSnapshot(ctrl, okQueue([]));
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
  test('a withdraw success that did not actually remove the row (removed:false) is corrected by an immediate re-read, never a vanished row', async () => {
    // The withdraw response never carries `removed` — a 200 is returned
    // whether or not the row was still claimable server-side (idempotent
    // no-op). If the row had already been claimed the instant before the
    // withdraw landed, the optimistic local removal is wrong; the very next
    // queue read (kicked immediately, not waited out on the poll interval)
    // must restore the true state instead of leaving nothing shown.
    const ctrl = controllableRead();
    nextWithdraw = async (runId, nodeId, messageId): Promise<WithdrawWorkflowNodeResponse> => {
      withdrawCalls.push({ runId, nodeId, messageId });
      return { success: true, message_id: messageId };
    };
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000 });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'redirect', state: 'queued' }])
    );
    expect(host.querySelector('li[data-message-id="id-a"]')).not.toBeNull();

    await clickDelete(0);
    expect(withdrawCalls).toHaveLength(1);

    // The kicked re-read reports the row was already claimed server-side —
    // `removed:false` in effect, now visible as `dispatching`.
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'redirect', state: 'dispatching' }])
    );
    const row = host.querySelector('li[data-message-id="id-a"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('sending…');
    expect(row?.textContent).not.toContain(STEERING_DELETE_LABEL);
  });

  test('a withdraw that genuinely removed the row stays removed after the kicked re-read confirms it', async () => {
    const ctrl = controllableRead();
    nextWithdraw = async (runId, nodeId, messageId): Promise<WithdrawWorkflowNodeResponse> => {
      withdrawCalls.push({ runId, nodeId, messageId });
      return { success: true, message_id: messageId };
    };
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000 });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'redirect', state: 'queued' }])
    );
    await clickDelete(0);
    // The withdraw response never says whether the row actually left the
    // queue — removing it here, before the kicked re-read confirms either
    // outcome, would blank the band for the race case where it did not.
    expect(host.querySelector('li[data-message-id="id-a"]')).not.toBeNull();

    // The kicked re-read confirms the row is genuinely gone.
    await settleSnapshot(ctrl, okQueue([]));
    expect(host.querySelector('li[data-message-id="id-a"]')).toBeNull();
    expect(host.querySelector('ul')).toBeNull();
  });

  test('deleting the last row focuses the previous delete; deleting the only row focuses the field', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read });
    // The poller fires its own read immediately on mount, before anything
    // is queued — drain it so it never lingers as a stale pending entry
    // that a later settleSnapshot below could resolve by mistake.
    await settleSnapshot(ctrl, okQueue([]));

    await setDraft('first');
    await clickQueue();
    await setDraft('second');
    await clickQueue();

    const previousDelete = deleteButtons()[0];
    await clickDelete(1);
    // Multi-item withdraw removes the row immediately — no need to wait for
    // its own kicked re-read, but drain it so it does not linger stale.
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect((win.document.activeElement as unknown) === previousDelete).toBe(true);
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: calls[0].body.message_id, message: 'first', state: 'queued' }])
    );

    await clickDelete(0);
    // Withdrawing the only remaining row defers removal to the kicked
    // re-read — still one row shown, and focus has not moved yet.
    expect(host.querySelectorAll('li')).toHaveLength(1);

    await settleSnapshot(ctrl, okQueue([]));
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
      expect(button.textContent?.trim()).toBe('✕');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.className).toContain('min-h-[24px]');
      expect(button.className).toContain('min-w-[24px]');
      expect(button.className).toContain('focus-visible:outline-accent-bright');
      expect(button.className).toContain('focus-visible:-outline-offset-2');
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
  test('a non-live, non-terminal row does a one-shot read with nothing to show; detached never reads', async () => {
    const ctrl = controllableRead();
    nextRead = ctrl.read;
    // A non-live row (Cancel/Abandon) qualifies for the same one-shot
    // hydration a terminal row gets — it may still have a queued item worth
    // showing read-only. An empty result correctly settles back to hidden.
    await renderDock({ live: false, nodeTerminal: false, readQueue: ctrl.read });
    await settleSnapshot(ctrl, okQueue([]));
    expect(readCalls).toHaveLength(1);
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('ul')).toBeNull();

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
    expect(items[0].textContent).not.toContain('sent');
    expect(items[1].textContent).toContain('beta');
    const band = list?.closest('section');
    expect(band?.textContent ?? '').not.toContain('saved for you');
    expect(band?.className).toContain('bg-surface-elevated');
    expect(band?.className).toContain('border-t');
    expect(band?.textContent).toContain('saved to server');
    const scroller = list?.parentElement;
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

  test('per-item Send now appears only while generating on a soft-injection provider', async () => {
    const ctrl = controllableRead();
    await renderDock({ subState: 'generating', pollIntervalMs: 60_000, readQueue: ctrl.read });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha' }], {
        capabilities: { soft_injection: true, delivery_ack: false },
        sub_state: 'generating',
      })
    );

    const item = host.querySelector('li[data-message-id="id-a"]');
    if (item === null) throw new Error('missing queued item');
    const sendNow = [...item.querySelectorAll('button')].find(
      button => (button.textContent ?? '').trim() === 'Send now'
    );
    if (sendNow === undefined) throw new Error('missing per-item Send now control');
    expect(sendNow.getAttribute('aria-label')).toBe('Send now · alpha');

    await act(async () => {
      sendNow.click();
    });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.intent).toBe('send_now');
    expect(calls[0]?.body.queued_message_id).toBe('id-a');
  });

  test('per-item Send now is absent without the capability flag', async () => {
    const ctrl = controllableRead();
    await renderDock({ subState: 'generating', pollIntervalMs: 60_000, readQueue: ctrl.read });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'alpha' }]));
    const item = host.querySelector('li[data-message-id="id-a"]');
    expect(
      [...(item?.querySelectorAll('button') ?? [])].some(
        button => (button.textContent ?? '').trim() === 'Send now'
      )
    ).toBe(false);
  });

  test('per-item Send now is absent while idle-after-interrupt even with the capability', async () => {
    const ctrl = controllableRead();
    await renderDock({
      subState: 'idle-after-interrupt',
      pollIntervalMs: 60_000,
      readQueue: ctrl.read,
    });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha' }], {
        capabilities: { soft_injection: true, delivery_ack: false },
      })
    );
    const item = host.querySelector('li[data-message-id="id-a"]');
    expect(
      [...(item?.querySelectorAll('button') ?? [])].some(
        button => (button.textContent ?? '').trim() === 'Send now'
      )
    ).toBe(false);
  });

  test('the queue band always states server persistence, and Auto-send on only when confirmed', async () => {
    const ctrl = controllableRead();
    await renderDock({ subState: 'generating', pollIntervalMs: 60_000, readQueue: ctrl.read });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'alpha' }]));
    const band = host.querySelector('ul[aria-label="Queued messages, 1"]')?.closest('section');
    expect(band?.textContent).toContain('saved to server');
    expect(band?.textContent).not.toContain('Auto-send on');
  });

  test('Auto-send on renders as a read-only indicator with the confirmed capability', async () => {
    const ctrl = controllableRead();
    await renderDock({ subState: 'generating', pollIntervalMs: 60_000, readQueue: ctrl.read });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha' }], { auto_send: true })
    );
    const band = host.querySelector('ul[aria-label="Queued messages, 1"]')?.closest('section');
    expect(band?.textContent).toContain('saved to server · Auto-send on');
    // The band's own collapse toggle (aria-expanded) incidentally contains
    // the status text; no OTHER button — one that could actually act on
    // auto-send — exists.
    expect(
      [...(band?.querySelectorAll('button:not([aria-expanded])') ?? [])].some(button =>
        (button.textContent ?? '').includes('Auto-send')
      )
    ).toBe(false);
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
  test('a remote snapshot leaves the draft field and pending retry untouched', async () => {
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
    expect(field().value).toBe('unsent draft · keep me');
    const pendingMessageId = calls[0]?.body.message_id;
    expect(pendingMessageId).toBeTruthy();

    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'alpha' },
        { message_id: 'id-b', message: 'beta' },
      ])
    );
    expect(field().value).toBe('unsent draft · keep me');
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

  // ---------------------------------------------------------------------------
  // Finished-iteration read-only dock.
  // ---------------------------------------------------------------------------

  const FINISHED = {
    liveRowId: 'occ-live',
    liveIteration: 3,
  } as const;

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
    expect(items[0]?.textContent).not.toContain('sent');
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
    await renderDock({});
    await setDraft('keep me across finished');
    expect(field().value).toBe('keep me across finished');

    await renderDock({
      rowStatus: 'completed',
      finishedIteration: FINISHED,
      onSelectLiveRow: (): void => undefined,
    });
    expect(host.querySelector('textarea')).toBeNull();

    await renderDock({ rowStatus: 'running' });
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
    await settleRejection(ctrl, new SteeringRequestError(409, 'run_terminal', 'run ended'));
    expect(host.querySelector('ul')).toBeNull();
    expect(host.textContent ?? '').not.toContain(DETACHED);
    expect(host.textContent).toContain('reading a finished iteration');

    // Count after the terminal 409, not before — the 1ms post-snapshot poll
    // may already be in flight when settleSnapshot returns (CI flake).
    const afterStop = readCalls.length;
    expect(afterStop).toBeGreaterThanOrEqual(2);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    await flush();
    expect(readCalls.length).toBe(afterStop);
    expect(ctrl.pendingCount()).toBe(0);
  });

  test('existing composer/blocked/hidden modes remain unchanged without descriptor', async () => {
    await renderDock({ rowStatus: 'running' });
    expect(host.querySelector('textarea')).not.toBeNull();
    expect(host.textContent).toContain('Cmd/Ctrl+Enter to send');

    await renderDock({ rowStatus: 'awaiting' });
    expect(host.querySelector('textarea')).not.toBeNull();
    expect(host.textContent).toContain("answer the agent's question first");

    await renderDock({ rowStatus: 'completed' });
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent ?? '').toBe('');
  });

  // ---------------------------------------------------------------------------
  // Never-sent terminal band: durable server rows, not a client-side ledger.
  // ---------------------------------------------------------------------------

  const NEVER_SENT_ALERT = 'node finished · none of this was sent';

  function neverSentList(): Element | null {
    return host.querySelector('ul[aria-label^="Never sent, "]');
  }

  function neverSentItems(): HTMLLIElement[] {
    const list = neverSentList();
    if (list === null) return [];
    return [...list.querySelectorAll('li')] as unknown as HTMLLIElement[];
  }

  test('renders never_sent rows straight from the terminal one-shot queue read', async () => {
    const ctrl = controllableRead();
    await renderDock({
      readQueue: ctrl.read,
      nodeTerminal: true,
      rowStatus: 'completed',
    });
    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'alpha', state: 'never_sent' },
        { message_id: 'id-b', message: 'beta', state: 'never_sent' },
      ])
    );
    const list = neverSentList();
    expect(list?.getAttribute('aria-label')).toBe('Never sent, 2');
    const items = neverSentItems();
    expect(items.map(item => item.getAttribute('data-message-id'))).toEqual(['id-a', 'id-b']);
    // Each row leads with its 1-based position number.
    expect(items.map(item => item.textContent)).toEqual(['1alpha', '2beta']);
    expect(host.textContent).toContain(NEVER_SENT_ALERT);
  });

  test('a cold mount already terminal reaches the same band with no live session ever observed', async () => {
    // Durable undelivered content survives a run being opened
    // well after it finished, not only a session that watched it happen.
    const ctrl = controllableRead();
    await renderDock({
      readQueue: ctrl.read,
      live: false,
      rowStatus: 'completed',
      nodeTerminal: true,
    });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha', state: 'never_sent' }])
    );
    expect(neverSentItems().map(item => item.getAttribute('data-message-id'))).toEqual(['id-a']);
  });

  test("the operator's own unsent draft folds in as the trailing item", async () => {
    const ctrl = controllableRead();
    const draft = draftReader('half-typed line');
    await renderDock({
      readQueue: ctrl.read,
      readDraft: draft.read,
      nodeTerminal: true,
      rowStatus: 'completed',
    });
    await draft.settle();
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha', state: 'never_sent' }])
    );
    const items = neverSentItems();
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute('data-message-id')).toBe('id-a');
    expect(items[1]?.getAttribute('data-message-id')).toBeNull();
    // The draft is the trailing item, so it carries the next position number.
    expect(items[1]?.textContent).toBe('2half-typed line');
  });

  test('a delivery_unknown row survives to the terminal band with its own label', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, nodeTerminal: true, rowStatus: 'completed' });
    await settleSnapshot(
      ctrl,
      okQueue(
        [
          { message_id: 'id-a', message: 'alpha', state: 'delivery_unknown' },
          { message_id: 'id-b', message: 'beta', state: 'never_sent' },
        ],
        { execution_state: 'finished' }
      )
    );
    const items = neverSentItems();
    // The header count and the rendered rows are the same list — they can
    // never disagree.
    expect(neverSentList()?.getAttribute('aria-label')).toBe('Never sent, 2');
    expect(items.map(item => item.getAttribute('data-message-id'))).toEqual(['id-a', 'id-b']);
    expect(items[0]?.textContent).toBe('1alphadelivery unknown');
    expect(items[1]?.textContent).toBe('2beta');
  });

  test('nothing undelivered and a blank draft renders no dock at all', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, nodeTerminal: true, rowStatus: 'completed' });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'alpha', state: 'sent' }]));
    expect(neverSentList()).toBeNull();
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent ?? '').toBe('');
  });

  test('withdrawing a row before the node finishes keeps it out of the terminal band', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 60_000 });
    await settleSnapshot(
      ctrl,
      okQueue([
        { message_id: 'id-a', message: 'keep' },
        { message_id: 'id-b', message: 'drop' },
      ])
    );
    await clickDelete(1);
    expect(withdrawCalls.some(c => c.messageId === 'id-b')).toBe(true);
    await renderDock({ readQueue: ctrl.read, nodeTerminal: true, rowStatus: 'completed' });
    // The withdraw's own corrective re-read (kicked while still polling,
    // before this render stopped it) is still pending from that earlier
    // moment; its eventual response is discarded once polling itself
    // stopped, so drain it before settling the terminal one-shot fetch this
    // render also triggered — the one carrying the durable answer.
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'keep' }]));
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'keep', state: 'never_sent' }])
    );
    expect(neverSentItems().map(item => item.getAttribute('data-message-id'))).toEqual(['id-a']);
  });

  test('a node that finishes while a send is still dispatching keeps the sending band, never a false never-sent one', async () => {
    // A message actively dispatching is the opposite of undelivered — the
    // node reaching terminal before the send resolves must not relabel it
    // "never sent" ahead of the server's own reconciliation. It keeps
    // showing as `sending` (the settling band, unrelabeled) until this
    // dock's own terminal read reconciles it.
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, nodeTerminal: true, rowStatus: 'completed' });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'in flight', state: 'dispatching' }])
    );
    expect(host.querySelector('ul')).not.toBeNull();
    expect(host.textContent ?? '').toContain('in flight');
    expect(host.textContent ?? '').not.toContain('never sent');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  // The host's own `nodeTerminal` prop (fed by a faster external signal,
  // e.g. another tab's Send now completing the node) can flip true before
  // THIS dock's own next queue poll has reconciled the item that prop refers
  // to — this tab's last-known local snapshot can still call it `queued`
  // even though the server already delivered it. The band must keep
  // showing that item, still labelled `queued`, through the gap (VQ6-3/
  // VQ9-3: never an empty frame between two non-empty snapshots) — never
  // relabeled `never sent` before the server's own terminal reconciliation
  // (`dock.neverSent`) says so.
  test("nodeTerminal arriving ahead of this dock's own queue poll keeps the band up, unrelabeled, until reconciled", async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, nodeTerminal: false, rowStatus: 'running' });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha', state: 'queued' }])
    );
    expect(host.querySelector('textarea')).not.toBeNull();

    // The host's faster external signal lands; this dock's own queue read
    // has not caught up yet (no new snapshot settled). No frame shows a
    // terminal room with the item missing.
    await renderDock({ readQueue: ctrl.read, nodeTerminal: true, rowStatus: 'completed' });
    expect(neverSentList()).toBeNull();
    expect(host.querySelector('ul')).not.toBeNull();
    expect(host.textContent ?? '').toContain('alpha');
    expect(host.textContent ?? '').not.toContain('never sent');

    // The dock's own terminal one-shot fetch resolves: the server says the
    // node is finished AND the item was actually delivered elsewhere, not
    // never-sent — the gate is open now (this read itself reports
    // `finished`), but a `delivered` row is still excluded on its own
    // merits, so the dock hides outright instead of showing a false
    // never-sent band.
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha', state: 'delivered' }], {
        execution_state: 'finished',
      })
    );
    expect(neverSentList()).toBeNull();
    expect(host.textContent ?? '').not.toContain('alpha');
  });

  test('an item still queued when the run is abandoned stays visible through to the reconciled Never sent, with no empty frame', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, nodeTerminal: false, rowStatus: 'running' });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha', state: 'queued' }])
    );
    expect(host.querySelector('textarea')).not.toBeNull();

    // Abandon: the run turns non-live before this dock's own queue read has
    // reconciled toward `finished`. The band stays up unchanged.
    await renderDock({ readQueue: ctrl.read, live: false, rowStatus: 'completed' });
    expect(host.querySelector('ul')).not.toBeNull();
    expect(host.textContent ?? '').toContain('alpha');
    expect(host.textContent ?? '').not.toContain('never sent');
    expect(neverSentList()).toBeNull();

    // The reconciled read lands: the item genuinely never made it out.
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'alpha', state: 'never_sent' }], {
        execution_state: 'finished',
      })
    );
    expect(neverSentList()).not.toBeNull();
    expect(host.textContent ?? '').toContain('alpha');
  });

  test('exact finished anatomy: heading, alert, and no controls', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, nodeTerminal: true, rowStatus: 'completed' });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'only', state: 'never_sent' }])
    );
    const headerButton = host.querySelector('button[aria-expanded]');
    const headerLabel = headerButton?.querySelector('span');
    expect(headerLabel?.textContent).toBe('never sent · 1');
    expect(headerLabel?.className ?? '').toContain('uppercase');
    expect(headerLabel?.className ?? '').toContain('tracking-[0.07em]');
    expect(neverSentList()?.getAttribute('aria-label')).toBe('Never sent, 1');
    const alerts = [...host.querySelectorAll('[role="alert"]')];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toBe(NEVER_SENT_ALERT);
    expect(host.querySelector('textarea')).toBeNull();
    expect(deleteButtons()).toHaveLength(0);
    expect(
      [...host.querySelectorAll('button')].some(b => {
        const t = (b.textContent ?? '').trim();
        return t === 'Stop' || t === 'Queue' || t === 'Send now' || t.startsWith('Go to');
      })
    ).toBe(false);
    expect(host.textContent ?? '').not.toContain('Cmd/Ctrl+Enter');
  });

  test('a cancelled run shows the read-only band for a still-queued item before the node reports terminal', async () => {
    // Abandon flips the run non-live at once; the node's own node_failed can
    // land tens of seconds later. The queued item must stay visible as
    // read-only through that whole window, not vanish until node_failed
    // arrives. The server reports `execution_state: 'finished'` for any
    // terminal run the instant it reads it (see api.ts's `isFinished`),
    // regardless of whether this specific row's own reconciliation has
    // landed yet — this dock's own read is what says so, which is exactly
    // the one signal the still-queued row is trustworthy under.
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, live: false, nodeTerminal: false });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'redirect' }], { execution_state: 'finished' })
    );
    expect(neverSentItems().map(item => item.getAttribute('data-message-id'))).toEqual(['id-a']);
    expect(host.querySelector('textarea')).toBeNull();
    expect(
      [...host.querySelectorAll('button')].some(b => {
        const t = (b.textContent ?? '').trim();
        return t === 'Stop' || t === 'Queue' || t === 'Send now';
      })
    ).toBe(false);
  });

  test('a durable item stays visible across the poll sequence an Abandon produces, before the slower run-detail poll reports terminal', async () => {
    // The `nodeTerminal` prop mirrors a 3s run-detail poll; this dock's own
    // ~1s queue poll can report `execution_state: 'finished'` and reconcile
    // the item to `never_sent` first. Simulates that exact intermediate
    // snapshot sequence with `nodeTerminal`/`rowStatus` still stale (as they
    // are for several seconds after a real Abandon) and asserts the item
    // never drops out of view.
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, pollIntervalMs: 1, rowStatus: 'running', live: true });

    // Snapshot 1: still generating, item queued.
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'redirect' }], { execution_state: 'live' })
    );
    expect(host.querySelector('li[data-message-id="id-a"]')).not.toBeNull();

    // Snapshot 2: Abandon has landed server-side — this poll's row is already
    // reconciled to `never_sent` and `execution_state` already reads
    // `finished` — but the caller's `nodeTerminal`/`rowStatus` props (driven
    // by the separate, slower run-detail poll) are unchanged.
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'redirect', state: 'never_sent' }], {
        execution_state: 'finished',
      })
    );
    expect(neverSentItems().map(item => item.getAttribute('data-message-id'))).toEqual(['id-a']);

    // Snapshot 3: the slower run-detail poll would eventually flip
    // `nodeTerminal`/`rowStatus` too (simulated by re-rendering), and the
    // item is still exactly where it was.
    await renderDock({
      readQueue: ctrl.read,
      pollIntervalMs: 1,
      rowStatus: 'completed',
      live: true,
      nodeTerminal: true,
    });
    expect(neverSentItems().map(item => item.getAttribute('data-message-id'))).toEqual(['id-a']);
  });

  test('the terminal fetch runs once per terminal transition, not once per render', async () => {
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, nodeTerminal: true, rowStatus: 'completed' });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'only', state: 'never_sent' }])
    );
    const readsSoFar = readCalls.length;
    await renderDock({
      readQueue: ctrl.read,
      nodeTerminal: true,
      rowStatus: 'completed',
      nodeLabel: 'implement-renamed',
    });
    expect(readCalls).toHaveLength(readsSoFar);
    expect(neverSentItems()).toHaveLength(1);
  });

  test('focus moves off a removed control when the node finishes', async () => {
    const focused: string[] = [];
    const focusLastRow = (): void => {
      focused.push('last-row');
    };
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, focusLastRow, pollIntervalMs: 60_000 });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'focus me out' }]));
    await act(async () => {
      field().focus();
    });
    await renderDock({
      readQueue: ctrl.read,
      nodeTerminal: true,
      rowStatus: 'completed',
      focusLastRow,
    });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'focus me out', state: 'never_sent' }])
    );
    expect(focused).toContain('last-row');
    expect(neverSentList()).not.toBeNull();
  });

  test('field focused, then the node finishes: focus moves off the field', async () => {
    let calls = 0;
    const focusLastRow = (): void => {
      calls += 1;
    };
    const ctrl = controllableRead();
    await renderDock({ readQueue: ctrl.read, focusLastRow, pollIntervalMs: 60_000 });
    await settleSnapshot(ctrl, okQueue([{ message_id: 'id-a', message: 'focus me out' }]));
    await act(async () => {
      field().focus();
    });
    await renderDock({
      readQueue: ctrl.read,
      nodeTerminal: true,
      rowStatus: 'completed',
      focusLastRow,
    });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'focus me out', state: 'never_sent' }])
    );
    expect(calls).toBeGreaterThan(0);
  });

  test('a cold mount straight into a finished node never moves focus', async () => {
    let calls = 0;
    const focusLastRow = (): void => {
      calls += 1;
    };
    const ctrl = controllableRead();
    // No prior composer render — this dock never held any focusable control,
    // so `document.activeElement` reads <body> for reasons unrelated to it.
    await renderDock({
      readQueue: ctrl.read,
      focusLastRow,
      nodeTerminal: true,
      rowStatus: 'completed',
      live: true,
    });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'never delivered', state: 'never_sent' }])
    );
    expect(neverSentList()).not.toBeNull();
    expect(calls).toBe(0);
    expect(win.document.activeElement).toBe(win.document.body);
  });

  test('a cold mount straight into a failed node never moves focus', async () => {
    let calls = 0;
    const focusLastRow = (): void => {
      calls += 1;
    };
    const ctrl = controllableRead();
    await renderDock({
      readQueue: ctrl.read,
      focusLastRow,
      nodeTerminal: true,
      rowStatus: 'failed',
      live: false,
    });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-a', message: 'never delivered', state: 'never_sent' }])
    );
    expect(neverSentList()).not.toBeNull();
    expect(calls).toBe(0);
  });

  test('a cold mount straight into a recovery-required node never moves focus', async () => {
    let calls = 0;
    const focusLastRow = (): void => {
      calls += 1;
    };
    const ctrl = controllableRead();
    // The dock's own first render (executionState still null) renders the
    // live composer optimistically; only the queue read below reclassifies
    // it as recovery-required. That controls-mount-then-unmount transition
    // must never treat `document.activeElement` reading `<body>` — true
    // here only because nothing was ever focused — as focus having been in
    // the dock and dropped.
    await renderDock({ readQueue: ctrl.read, focusLastRow, pollIntervalMs: 60_000 });
    await settleSnapshot(ctrl, okQueue([], { execution_state: 'recovery_required' }));
    expect(host.textContent).toContain(
      'restored after server restart · Resume the workflow to continue'
    );
    expect(calls).toBe(0);
    expect(win.document.activeElement).toBe(win.document.body);
  });

  // ---------------------------------------------------------------------------
  // Idle-after-interrupt disclosure, keepalive coalescing, and idle-await expiry copy.
  // ---------------------------------------------------------------------------

  const IDLE_DISCLOSURE =
    'no redirect ends this node after 30 min of inactivity · typing keeps it open';
  const EXPIRED_ALERT = 'node failed · interrupted with no redirect · none of this was sent';
  const STOP_DISCLOSURE =
    'stopped after the last completed tool call · files already written stay written';

  test('idle disclosure follows Stop text; other states omit it', async () => {
    await renderDock({ subState: 'idle-after-interrupt' });
    const text = host.textContent ?? '';
    expect(text).toContain(STOP_DISCLOSURE);
    expect(text).toContain(IDLE_DISCLOSURE);
    expect(text.indexOf(STOP_DISCLOSURE)).toBeLessThan(text.indexOf(IDLE_DISCLOSURE));

    await renderDock({ subState: 'generating' });
    expect(host.textContent ?? '').not.toContain(IDLE_DISCLOSURE);

    await renderDock();
    expect(host.textContent ?? '').not.toContain(IDLE_DISCLOSURE);

    await renderDock({
      rowStatus: 'completed',
      nodeTerminal: true,
      nodeExecutionKey: 'exec-1',
    });
    expect(host.textContent ?? '').not.toContain(IDLE_DISCLOSURE);
  });

  test('focus plus rapid typing produces one immediate keepalive', async () => {
    await renderDock({ subState: 'idle-after-interrupt', nodeExecutionKey: 'exec-1' });
    expect(keepaliveCalls).toHaveLength(0);
    await act(async () => {
      field().focus();
    });
    await flush();
    expect(keepaliveCalls).toEqual([{ runId: 'run-1', nodeId: 'grp.body' }]);
    await setDraft('r');
    await pressKey({ key: 'r', keyCode: 82 });
    await pressKey({ key: 'e', keyCode: 69 });
    await pressKey({ key: 'd', keyCode: 68 });
    expect(keepaliveCalls).toHaveLength(1);
    expect(field().value).toBe('r');
  });

  test('Send now excludes keepalive; intent is send_now', async () => {
    await renderDock({ subState: 'idle-after-interrupt', nodeExecutionKey: 'exec-1' });
    await setDraft('redirect the agent');
    await act(async () => {
      field().focus();
    });
    await flush();
    const baseline = keepaliveCalls.length;
    await clickSendNow();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.intent).toBe('send_now');
    expect(keepaliveCalls).toHaveLength(baseline);

    await renderDock({ subState: 'idle-after-interrupt', nodeExecutionKey: 'exec-2' });
    await setDraft('keyboard send');
    await act(async () => {
      field().focus();
    });
    await flush();
    const afterFocus = keepaliveCalls.length;
    await pressKey({ key: 'Enter', metaKey: true, keyCode: 13 });
    expect(calls.at(-1)?.body.intent).toBe('send_now');
    expect(keepaliveCalls).toHaveLength(afterFocus);
  });

  test('non-idle focus/typing sends no keepalive', async () => {
    await renderDock({ subState: 'generating', nodeExecutionKey: 'exec-1' });
    await act(async () => {
      field().focus();
    });
    await pressKey({ key: 'a', keyCode: 65 });
    expect(keepaliveCalls).toHaveLength(0);

    await renderDock({
      rowStatus: 'completed',
      nodeTerminal: true,
      nodeExecutionKey: 'exec-1',
    });
    expect(host.querySelector('textarea')).toBeNull();
    expect(keepaliveCalls).toHaveLength(0);
  });

  test('rejected keepalive stays eligible without refusal UI', async () => {
    let rejectNext = true;
    nextKeepalive = async (runId, nodeId): Promise<KeepaliveWorkflowNodeResponse> => {
      keepaliveCalls.push({ runId, nodeId });
      if (rejectNext) {
        rejectNext = false;
        throw new SteeringRequestError(0, null, 'network down');
      }
      return { success: true };
    };
    await renderDock({ subState: 'idle-after-interrupt', nodeExecutionKey: 'exec-1' });
    await act(async () => {
      field().focus();
    });
    await flush();
    expect(keepaliveCalls).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent ?? '').not.toContain("couldn't");
    await pressKey({ key: 'x', keyCode: 88 });
    expect(keepaliveCalls).toHaveLength(1);
  });

  test('leaving idle or changing attempt key cleans up; new idle sends immediately', async () => {
    await renderDock({ subState: 'idle-after-interrupt', nodeExecutionKey: 'exec-1' });
    await act(async () => {
      field().focus();
    });
    await flush();
    expect(keepaliveCalls).toHaveLength(1);

    await renderDock({ subState: 'idle-after-interrupt', nodeExecutionKey: 'exec-2' });
    await act(async () => {
      field().blur();
      field().focus();
    });
    await flush();
    expect(keepaliveCalls).toHaveLength(2);
  });

  test('cause-specific terminal box uses exact expiry copy', async () => {
    const ctrl = controllableRead();
    await renderDock({
      readQueue: ctrl.read,
      rowStatus: 'failed',
      nodeTerminal: true,
      idleAwaitExpired: true,
    });
    await settleSnapshot(
      ctrl,
      okQueue([{ message_id: 'id-b', message: 'beta', state: 'never_sent' }])
    );
    expect(neverSentList()?.getAttribute('aria-label')).toBe('Never sent, 1');
    expect(neverSentItems()[0]?.textContent).toBe('1beta');
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(host.textContent).toContain(EXPIRED_ALERT);
    expect(host.textContent).not.toContain(NEVER_SENT_ALERT);

    const ctrl2 = controllableRead();
    await renderDock({
      nodeId: 'grp.other',
      readQueue: ctrl2.read,
      rowStatus: 'completed',
      nodeTerminal: true,
      idleAwaitExpired: false,
    });
    await settleSnapshot(
      ctrl2,
      okQueue([{ message_id: 'id-c', message: 'gamma', state: 'never_sent' }])
    );
    expect(host.textContent).toContain(NEVER_SENT_ALERT);
    expect(host.textContent).not.toContain(EXPIRED_ALERT);
  });

  test('expired empty terminal renders no dock shell', async () => {
    const ctrl = controllableRead();
    await renderDock({
      readQueue: ctrl.read,
      rowStatus: 'failed',
      nodeTerminal: true,
      idleAwaitExpired: true,
    });
    await settleSnapshot(ctrl, okQueue([]));
    expect(host.querySelector('textarea')).toBeNull();
    expect(neverSentList()).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent ?? '').toBe('');
  });
});
