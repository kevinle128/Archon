import { describe, expect, test } from 'bun:test';

import {
  applyQueueSnapshot,
  beginGuidanceSubmission,
  beginInterrupt,
  beginSendNow,
  beginWithdraw,
  canSubmitGuidance,
  createSteeringDockState,
  deleteButtonAccessibleName,
  finishedIterationDisclosure,
  focusTargetAfterSnapshot,
  goToIterationLabel,
  isQueueShortcut,
  loadSteeringDraft,
  nextFocusAfterRemoval,
  queueBandHeader,
  queueButtonAccessibleName,
  queueListLabel,
  queuedCountPhrase,
  resolveGuidanceFailure,
  resolveGuidanceSuccess,
  resolveInterruptError,
  resolveInterruptOutcome,
  resolveSendNowFailure,
  resolveSendNowSuccess,
  resolveWithdrawFailure,
  resolveWithdrawSuccess,
  saveSteeringDraft,
  sendNowButtonAccessibleName,
  startQueuePolling,
  steeringAgentMode,
  steeringBlockedReason,
  steeringDockMode,
  steeringDraftStorageKey,
  syncProjectedSubState,
  STEERING_AGENT_GENERATING,
  STEERING_AGENT_IDLE,
  STEERING_AGENT_INTERRUPTING,
  STEERING_ASK_BLOCKED_REASON,
  STEERING_DELETE_LABEL,
  STEERING_DETACHED_DISCLOSURE,
  STEERING_INTERRUPT_DISCLOSURE,
  STEERING_INTERRUPT_FAILED_MESSAGE,
  STEERING_SEND_FAILED_MESSAGE,
  STEERING_SEND_HINT,
  SteeringRequestError,
  toSteeringRefusal,
  toSteeringRequestError,
  willSendBandHeader,
  willSendCountPhrase,
  willSendListLabel,
  type LocalSentReceipt,
  type QueuedGuidanceRow,
  type SteeringDockState,
} from './steering-dock';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length(): number {
      return map.size;
    },
    clear: (): void => map.clear(),
    getItem: (key: string): string | null => map.get(key) ?? null,
    key: (index: number): string | null => [...map.keys()][index] ?? null,
    removeItem: (key: string): void => {
      map.delete(key);
    },
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    },
  };
}

function modeFor(
  rowStatus: string,
  overrides?: {
    live?: boolean;
    hasPendingAsk?: boolean;
    refusal?: { code: string | null; message: string } | null;
    finishedIteration?: { liveRowId: string; liveIteration: number } | null;
  }
): string {
  return steeringDockMode({
    rowStatus,
    live: overrides?.live ?? true,
    hasPendingAsk: overrides?.hasPendingAsk ?? false,
    refusal: overrides?.refusal ?? null,
    finishedIteration: overrides?.finishedIteration,
  });
}

describe('steeringDockMode visibility table', () => {
  test('running live row shows the composer', () => {
    expect(modeFor('running')).toBe('composer');
  });

  test('awaiting row blocks even without a visible pending ask', () => {
    expect(modeFor('awaiting')).toBe('blocked');
  });

  test('pending ask on this node blocks a running row', () => {
    expect(modeFor('running', { hasPendingAsk: true })).toBe('blocked');
  });

  test.each(['pending', 'completed', 'failed', 'skipped', 'cancelled', 'unknown', ''])(
    'non-generating row status %s hides the dock',
    status => {
      expect(modeFor(status)).toBe('hidden');
    }
  );

  test('non-live historical execution hides the dock even for a running row', () => {
    expect(modeFor('running', { live: false })).toBe('hidden');
    expect(modeFor('awaiting', { live: false })).toBe('hidden');
  });

  test('stored 422 not_steerable_here flips a generating row to detached', () => {
    expect(
      modeFor('running', {
        refusal: { code: 'not_steerable_here', message: 'detached' },
      })
    ).toBe('detached');
  });

  test('a pending ask keeps its blocked reason over a stored detached refusal', () => {
    expect(
      modeFor('running', {
        hasPendingAsk: true,
        refusal: { code: 'not_steerable_here', message: 'detached' },
      })
    ).toBe('blocked');
  });

  test('other refusal codes leave the composer visible', () => {
    expect(modeFor('running', { refusal: { code: 'node_finished', message: 'done' } })).toBe(
      'composer'
    );
    expect(modeFor('running', { refusal: { code: null, message: 'offline' } })).toBe('composer');
  });

  test('a valid finished-iteration descriptor on a completed row selects finished-iteration before terminal hide', () => {
    expect(
      modeFor('completed', {
        finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
      })
    ).toBe('finished-iteration');
  });

  test('non-live still hides even with a finished-iteration descriptor', () => {
    expect(
      modeFor('completed', {
        live: false,
        finishedIteration: { liveRowId: 'occ-2', liveIteration: 2 },
      })
    ).toBe('hidden');
  });

  test('absent finished-iteration descriptor leaves the visibility table unchanged', () => {
    expect(modeFor('completed')).toBe('hidden');
    expect(modeFor('running')).toBe('composer');
    expect(modeFor('awaiting')).toBe('blocked');
  });
});

describe('steeringBlockedReason', () => {
  test('awaiting row or pending ask returns the exact copy', () => {
    expect(steeringBlockedReason({ rowStatus: 'awaiting', hasPendingAsk: false })).toBe(
      "answer the agent's question first"
    );
    expect(steeringBlockedReason({ rowStatus: 'running', hasPendingAsk: true })).toBe(
      STEERING_ASK_BLOCKED_REASON
    );
  });

  test('plain running row is unblocked', () => {
    expect(steeringBlockedReason({ rowStatus: 'running', hasPendingAsk: false })).toBeNull();
  });
});

describe('steeringAgentMode derivation', () => {
  test('absent projected sub-state means queue-only, not detached', () => {
    expect(steeringAgentMode({ subState: null, interruptInFlight: false })).toBe('queue-only');
  });

  test('projected generating and idle map through', () => {
    expect(steeringAgentMode({ subState: 'generating', interruptInFlight: false })).toBe(
      'generating'
    );
    expect(steeringAgentMode({ subState: 'idle-after-interrupt', interruptInFlight: false })).toBe(
      'idle'
    );
  });

  test('the local interrupting transient overrides any projection', () => {
    expect(steeringAgentMode({ subState: 'generating', interruptInFlight: true })).toBe(
      'interrupting'
    );
    expect(steeringAgentMode({ subState: 'idle-after-interrupt', interruptInFlight: true })).toBe(
      'interrupting'
    );
  });
});

describe('syncProjectedSubState', () => {
  test('a defined projection supersedes the local interrupting transient', () => {
    const interrupting = beginInterrupt(createSteeringDockState('generating'));
    const synced = syncProjectedSubState(interrupting, 'idle-after-interrupt');
    expect(synced.interruptInFlight).toBe(false);
    expect(synced.subState).toBe('idle-after-interrupt');
    expect(synced.notice).toBe(STEERING_AGENT_IDLE);
  });

  test('an absent projection keeps the transient and writes no notice', () => {
    const interrupting = beginInterrupt(createSteeringDockState('generating'));
    const synced = syncProjectedSubState(interrupting, undefined);
    expect(synced.interruptInFlight).toBe(true);
    expect(synced.subState).toBeNull();
    expect(synced.notice).toBe(STEERING_AGENT_INTERRUPTING);
  });

  test('an unchanged projection returns the same state', () => {
    const state = createSteeringDockState('generating');
    expect(syncProjectedSubState(state, 'generating')).toBe(state);
  });

  test('a generating projection announces agent generating', () => {
    const idle = createSteeringDockState('idle-after-interrupt');
    const synced = syncProjectedSubState(idle, 'generating');
    expect(synced.subState).toBe('generating');
    expect(synced.notice).toBe(STEERING_AGENT_GENERATING);
  });
});

describe('canSubmitGuidance', () => {
  test.each([
    ['   ', false],
    ['\n\t ', false],
    ['', false],
    ['x', true],
    ['  keep the padding  ', true],
  ])('draft %j submittable=%s', (draft, expected) => {
    expect(canSubmitGuidance({ mode: 'composer', sendInFlight: false, draft })).toBe(expected);
  });

  test('in-flight send or non-composer modes refuse', () => {
    expect(canSubmitGuidance({ mode: 'composer', sendInFlight: true, draft: 'x' })).toBe(false);
    for (const mode of ['hidden', 'blocked', 'detached'] as const) {
      expect(canSubmitGuidance({ mode, sendInFlight: false, draft: 'x' })).toBe(false);
    }
  });

  test('Send now needs a non-blank newly typed draft even with queued receipts', () => {
    expect(canSubmitGuidance({ mode: 'composer', sendInFlight: false, draft: '' })).toBe(false);
    expect(canSubmitGuidance({ mode: 'composer', sendInFlight: false, draft: '  ' })).toBe(false);
  });

  test('finished-iteration mode refuses submit', () => {
    expect(canSubmitGuidance({ mode: 'finished-iteration', sendInFlight: false, draft: 'x' })).toBe(
      false
    );
  });
});

describe('isQueueShortcut', () => {
  const base = { key: 'Enter', metaKey: false, ctrlKey: false, isComposing: false, keyCode: 13 };

  test('Cmd+Enter and Ctrl+Enter submit', () => {
    expect(isQueueShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isQueueShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isQueueShortcut({ ...base, metaKey: true, ctrlKey: true })).toBe(true);
  });

  test('plain Enter and Shift+Enter do not submit', () => {
    expect(isQueueShortcut(base)).toBe(false);
    expect(isQueueShortcut({ ...base, metaKey: false, ctrlKey: false })).toBe(false);
  });

  test('non-Enter keys never submit', () => {
    expect(isQueueShortcut({ ...base, key: 'a', metaKey: true })).toBe(false);
  });

  test('IME composition guards both isComposing and key code 229', () => {
    expect(isQueueShortcut({ ...base, metaKey: true, isComposing: true })).toBe(false);
    expect(isQueueShortcut({ ...base, metaKey: true, keyCode: 229 })).toBe(false);
  });
});

describe('submission state transitions', () => {
  let counter = 0;
  const newId = (): string => `id-${(++counter).toString()}`;

  test('begin stamps one uuid and marks the send in flight', () => {
    const begun = beginGuidanceSubmission(createSteeringDockState(), 'hello', newId);
    expect(begun.messageId).toBe('id-1');
    expect(begun.state.sendInFlight).toBe(true);
    expect(begun.state.pendingRetry).toEqual({ messageId: 'id-1', message: 'hello' });
  });

  test('unchanged draft after an ambiguous failure reuses the stored id', () => {
    const first = beginGuidanceSubmission(createSteeringDockState(), 'retry me', newId);
    const failed = resolveGuidanceFailure(first.state, { code: null, message: 'lost' });
    const retried = beginGuidanceSubmission(failed, 'retry me', newId);
    expect(retried.messageId).toBe(first.messageId);
  });

  test('editing the draft mints a new submission id', () => {
    const first = beginGuidanceSubmission(createSteeringDockState(), 'one', newId);
    const failed = resolveGuidanceFailure(first.state, { code: null, message: 'lost' });
    const edited = beginGuidanceSubmission(failed, 'one edited', newId);
    expect(edited.messageId).not.toBe(first.messageId);
  });

  test('success appends the receipt with its message text and clears retry state', () => {
    const begun = beginGuidanceSubmission(createSteeringDockState(), 'first', newId);
    const next = resolveGuidanceSuccess(begun.state, {
      message_id: begun.messageId,
      state: 'queued',
    });
    expect(next.sent).toEqual([{ messageId: begun.messageId, message: 'first', state: 'queued' }]);
    expect(next.sendInFlight).toBe(false);
    expect(next.pendingRetry).toBeNull();
    expect(next.refusal).toBeNull();
    expect(next.notice).toBe('1 message queued');
  });

  test('the wire receipt state is kept verbatim', () => {
    const begun = beginGuidanceSubmission(createSteeringDockState(), 'first', newId);
    const next = resolveGuidanceSuccess(begun.state, {
      message_id: begun.messageId,
      state: 'awaiting_send_now',
    });
    expect(next.sent[0]?.state).toBe('awaiting_send_now');
  });

  test('two successful sends keep acceptance order', () => {
    let state: SteeringDockState = createSteeringDockState();
    const first = beginGuidanceSubmission(state, 'alpha', newId);
    state = resolveGuidanceSuccess(first.state, { message_id: first.messageId });
    const second = beginGuidanceSubmission(state, 'beta', newId);
    state = resolveGuidanceSuccess(second.state, { message_id: second.messageId });
    expect(state.sent.map(entry => entry.message)).toEqual(['alpha', 'beta']);
    expect(state.notice).toBe('2 messages queued');
  });

  test('a replayed 200 dedupes by message_id', () => {
    const begun = beginGuidanceSubmission(createSteeringDockState(), 'once', newId);
    const first = resolveGuidanceSuccess(begun.state, { message_id: begun.messageId });
    const second = resolveGuidanceSuccess(
      { ...first, pendingRetry: { messageId: begun.messageId, message: 'once' } },
      { message_id: begun.messageId }
    );
    expect(second.sent).toHaveLength(1);
  });

  test('failure preserves the pending retry and sets the refusal', () => {
    const begun = beginGuidanceSubmission(createSteeringDockState(), 'kept', newId);
    const failed = resolveGuidanceFailure(begun.state, { code: 'node_finished', message: 'done' });
    expect(failed.sendInFlight).toBe(false);
    expect(failed.pendingRetry).toEqual({ messageId: begun.messageId, message: 'kept' });
    expect(failed.refusal).toEqual({ code: 'node_finished', message: 'done' });
  });

  test('sent verbatim: non-blank whitespace survives untouched', () => {
    const draft = '  pad me\n';
    const begun = beginGuidanceSubmission(createSteeringDockState(), draft, newId);
    expect(begun.state.pendingRetry?.message).toBe(draft);
  });
});

describe('withdraw transitions', () => {
  const receipt = (messageId: string, message: string): LocalSentReceipt => ({
    messageId,
    message,
    state: 'queued',
  });

  function stateWith(
    sent: readonly LocalSentReceipt[],
    overrides?: Partial<SteeringDockState>
  ): SteeringDockState {
    return { ...createSteeringDockState(), sent, ...overrides };
  }

  test('initial state has no active withdraw', () => {
    expect(createSteeringDockState().withdrawingMessageId).toBeNull();
  });

  test('begin marks an existing receipt withdrawing and changes nothing else', () => {
    const state = stateWith([receipt('a', 'alpha'), receipt('b', 'beta')], {
      pendingRetry: { messageId: 'p', message: 'wip' },
      refusal: { code: 'node_finished', message: 'done' },
    });
    const begun = beginWithdraw(state, 'a');
    expect(begun.withdrawingMessageId).toBe('a');
    expect(begun.sent).toBe(state.sent);
    expect(begun.sendInFlight).toBe(state.sendInFlight);
    expect(begun.pendingRetry).toBe(state.pendingRetry);
    expect(begun.refusal).toBe(state.refusal);
  });

  test('begin for a missing id or while another withdraw is active is a same-state no-op', () => {
    const state = stateWith([receipt('a', 'alpha')]);
    expect(beginWithdraw(state, 'missing')).toBe(state);
    const active = beginWithdraw(state, 'a');
    expect(beginWithdraw(active, 'a')).toBe(active);
    expect(beginWithdraw(active, 'missing')).toBe(active);
  });

  test('success removes only the matching row, preserves order and send state, clears id and refusal', () => {
    const state = stateWith([receipt('a', 'alpha'), receipt('b', 'beta'), receipt('c', 'gamma')], {
      pendingRetry: { messageId: 'p', message: 'wip' },
      refusal: { code: 'stale', message: 'old' },
    });
    const resolved = resolveWithdrawSuccess(beginWithdraw(state, 'b'), 'b');
    expect(resolved.sent).toEqual([receipt('a', 'alpha'), receipt('c', 'gamma')]);
    expect(resolved.withdrawingMessageId).toBeNull();
    expect(resolved.refusal).toBeNull();
    expect(resolved.pendingRetry).toEqual({ messageId: 'p', message: 'wip' });
  });

  test('success for a stale or mismatched id is a no-op', () => {
    const idle = stateWith([receipt('a', 'alpha')]);
    expect(resolveWithdrawSuccess(idle, 'a')).toBe(idle);
    const active = beginWithdraw(stateWith([receipt('a', 'alpha'), receipt('b', 'beta')]), 'a');
    expect(resolveWithdrawSuccess(active, 'b')).toBe(active);
  });

  test('failure retains rows and send state, stores refusal, clears the matching id', () => {
    const state = stateWith([receipt('a', 'alpha'), receipt('b', 'beta')], {
      pendingRetry: { messageId: 'p', message: 'wip' },
    });
    const failed = resolveWithdrawFailure(beginWithdraw(state, 'a'), 'a', {
      code: 'node_finished',
      message: 'done',
    });
    expect(failed.sent).toBe(state.sent);
    expect(failed.pendingRetry).toEqual({ messageId: 'p', message: 'wip' });
    expect(failed.withdrawingMessageId).toBeNull();
    expect(failed.refusal).toEqual({ code: 'node_finished', message: 'done' });
  });

  test('failure for a mismatched id is a no-op', () => {
    const active = beginWithdraw(stateWith([receipt('a', 'alpha')]), 'a');
    expect(resolveWithdrawFailure(active, 'other', { code: 'x', message: 'nope' })).toBe(active);
  });

  test('a send success during an active withdraw appends and keeps the withdraw id', () => {
    const state = stateWith([receipt('a', 'alpha')], {
      pendingRetry: { messageId: 'p', message: 'second' },
    });
    const active = beginWithdraw(state, 'a');
    const resolved = resolveGuidanceSuccess(active, { message_id: 'p' });
    expect(resolved.sent).toEqual([receipt('a', 'alpha'), receipt('p', 'second')]);
    expect(resolved.withdrawingMessageId).toBe('a');
  });

  test('accessible name starts with the visible label, trims, and names the message', () => {
    expect(STEERING_DELETE_LABEL).toBe('delete');
    expect(deleteButtonAccessibleName('keep the padding  ')).toBe('delete · keep the padding');
    expect(deleteButtonAccessibleName('  wrong suite')).toBe('delete · wrong suite');
    expect(deleteButtonAccessibleName('one').startsWith('delete')).toBe(true);
  });

  test('focus moves next, then previous, then field; unknown resolves to field', () => {
    expect(nextFocusAfterRemoval(['a', 'b', 'c'], 'b')).toEqual({
      kind: 'delete',
      messageId: 'c',
    });
    expect(nextFocusAfterRemoval(['a', 'b', 'c'], 'c')).toEqual({
      kind: 'delete',
      messageId: 'b',
    });
    expect(nextFocusAfterRemoval(['a'], 'a')).toEqual({ kind: 'field' });
    expect(nextFocusAfterRemoval(['a', 'b'], 'missing')).toEqual({ kind: 'field' });
  });
});

describe('interrupt transitions', () => {
  test('begin sets the local transient and one polite announcement', () => {
    const next = beginInterrupt(createSteeringDockState('generating'));
    expect(next.interruptInFlight).toBe(true);
    expect(next.notice).toBe('agent interrupting');
    expect(next.sendInFlight).toBe(false);
  });

  test('200 idle clears the transient and announces Send now delivers', () => {
    const interrupting = beginInterrupt(createSteeringDockState('generating'));
    const next = resolveInterruptOutcome(interrupting, 'idle-after-interrupt');
    expect(next.interruptInFlight).toBe(false);
    expect(next.subState).toBe('idle-after-interrupt');
    expect(next.notice).toBe('agent idle · Send now delivers');
  });

  test('200 generating is a spent interrupt — composite race announcement', () => {
    let state = createSteeringDockState('generating');
    const send = beginGuidanceSubmission(state, 'held', () => 'm-1');
    state = resolveGuidanceSuccess(send.state, { message_id: send.messageId });
    const second = beginGuidanceSubmission(state, 'held too', () => 'm-2');
    state = resolveGuidanceSuccess(second.state, { message_id: second.messageId });
    const interrupting = beginInterrupt(state);
    const next = resolveInterruptOutcome(interrupting, 'generating');
    expect(next.subState).toBe('generating');
    expect(next.interruptInFlight).toBe(false);
    expect(next.notice).toBe('turn ended before stop · 2 sent · agent generating');
    expect(next.sent).toHaveLength(2);
  });

  test('a refusal clears the transient and keeps draft/receipts for the alert', () => {
    let state = createSteeringDockState('generating');
    const send = beginGuidanceSubmission(state, 'held', () => 'm-1');
    state = resolveGuidanceSuccess(send.state, { message_id: send.messageId });
    const interrupting = beginInterrupt(state);
    const next = resolveInterruptError(interrupting, {
      code: 'not_steerable_here',
      message: 'No live steering session',
    });
    expect(next.interruptInFlight).toBe(false);
    expect(next.subState).toBe('generating');
    expect(next.sent).toHaveLength(1);
    expect(next.refusal).toEqual({
      code: 'not_steerable_here',
      message: 'No live steering session',
    });
  });

  test('409 node_finished flows through the same refusal path', () => {
    const interrupting = beginInterrupt(createSteeringDockState('generating'));
    const next = resolveInterruptError(interrupting, {
      code: 'node_finished',
      message: 'Workflow node is finished',
    });
    expect(next.refusal?.code).toBe('node_finished');
    expect(next.interruptInFlight).toBe(false);
  });
});

describe('send now batch transitions', () => {
  let counter = 0;
  const newId = (): string => `sn-${(++counter).toString()}`;

  function idleWithReceipts(messages: string[]): SteeringDockState {
    let state = createSteeringDockState('idle-after-interrupt');
    for (const message of messages) {
      const begun = beginGuidanceSubmission(state, message, newId);
      state = resolveGuidanceSuccess(begun.state, { message_id: begun.messageId });
    }
    return state;
  }

  test('begin snapshots the band plus new draft into inFlightBatch and clears it optimistically', () => {
    const state = idleWithReceipts(['first', 'second']);
    const begun = beginSendNow(state, 'redirect now', newId);
    expect(begun.state.sent).toEqual([]);
    expect(begun.state.inFlightBatch?.map(entry => entry.message)).toEqual([
      'first',
      'second',
      'redirect now',
    ]);
    expect(begun.state.sendInFlight).toBe(true);
    expect(begun.state.pendingRetry).toEqual({
      messageId: begun.messageId,
      message: 'redirect now',
    });
  });

  test('an ambiguous Queue retry keeps its id and queued receipt instead of faking Send-now success', () => {
    const queued = beginGuidanceSubmission(
      createSteeringDockState('idle-after-interrupt'),
      'redirect now',
      newId
    );
    const queueFailed = resolveGuidanceFailure(queued.state, { code: null, message: 'lost' });
    const sendNow = beginSendNow(queueFailed, 'redirect now', newId);
    const resolved = resolveSendNowSuccess(sendNow.state, {
      message_id: sendNow.messageId,
      state: 'queued',
    });

    expect(sendNow.messageId).toBe(queued.messageId);
    expect(resolved.subState).toBe('idle-after-interrupt');
    expect(resolved.sent.map(entry => entry.message)).toEqual(['redirect now']);
    expect(resolved.pendingRetry).toBeNull();
    expect(resolved.notice).toBe('1 message will send');
  });

  test('success discards the batch, derives generating, announces once', () => {
    const state = idleWithReceipts(['first']);
    const begun = beginSendNow(state, 'redirect now', newId);
    const next = resolveSendNowSuccess(begun.state, {
      message_id: begun.messageId,
      state: 'awaiting_send_now',
    });
    expect(next.sent).toEqual([]);
    expect(next.inFlightBatch).toBeNull();
    expect(next.pendingRetry).toBeNull();
    expect(next.subState).toBe('generating');
    expect(next.notice).toBe('agent generating');
  });

  test('a replayed success after settlement never drains twice', () => {
    const state = idleWithReceipts(['first']);
    const begun = beginSendNow(state, 'redirect now', newId);
    const receipt = { message_id: begun.messageId, state: 'awaiting_send_now' as const };
    const settled = resolveSendNowSuccess(begun.state, receipt);
    const replay = resolveSendNowSuccess(settled, receipt);
    expect(replay).toBe(settled);
  });

  test('failure restores old then new items and retains the stable retry id', () => {
    const state = idleWithReceipts(['first', 'second']);
    const begun = beginSendNow(state, 'redirect now', newId);
    const failed = resolveSendNowFailure(begun.state, {
      code: null,
      message: STEERING_SEND_FAILED_MESSAGE,
    });
    expect(failed.sent.map(entry => entry.message)).toEqual(['first', 'second', 'redirect now']);
    expect(failed.inFlightBatch).toBeNull();
    expect(failed.sendInFlight).toBe(false);
    expect(failed.subState).toBe('idle-after-interrupt');
    expect(failed.refusal?.message).toBe("couldn't send · back in the queue");

    const retried = beginSendNow(failed, 'redirect now', newId);
    expect(retried.messageId).toBe(begun.messageId);
    expect(retried.state.inFlightBatch?.map(entry => entry.message)).toEqual([
      'first',
      'second',
      'redirect now',
    ]);
  });

  test('editing a failed Send-now draft replaces its restored display row and id', () => {
    const begun = beginSendNow(idleWithReceipts(['first']), 'redirect now', newId);
    const failed = resolveSendNowFailure(begun.state, { code: null, message: 'lost' });
    const edited = beginSendNow(failed, 'redirect edited', newId);

    expect(edited.messageId).not.toBe(begun.messageId);
    expect(edited.state.inFlightBatch?.map(entry => entry.message)).toEqual([
      'first',
      'redirect edited',
    ]);
  });

  test('a terminal projection supersedes an idle send-now state', () => {
    const state = idleWithReceipts(['first']);
    const begun = beginSendNow(state, 'redirect now', newId);
    const failed = resolveSendNowFailure(begun.state, { code: null, message: 'lost' });
    const synced = syncProjectedSubState(failed, 'generating');
    expect(synced.subState).toBe('generating');
    expect(synced.notice).toBe('agent generating');
    expect(synced.sent).toHaveLength(2);
  });
});

describe('sessionStorage draft persistence', () => {
  test('round trips draft plus pending retry scoped by run and node', () => {
    const storage = memoryStorage();
    const key = steeringDraftStorageKey('run-1', 'grp.body');
    expect(key).toBe('archon:steering-draft:run-1:grp.body');
    saveSteeringDraft(storage, key, {
      draft: 'wip',
      pendingRetry: { messageId: 'm-1', message: 'wip' },
    });
    expect(loadSteeringDraft(storage, key)).toEqual({
      draft: 'wip',
      pendingRetry: { messageId: 'm-1', message: 'wip' },
    });
  });

  test('empty draft with no retry removes the key', () => {
    const storage = memoryStorage();
    const key = steeringDraftStorageKey('run-1', 'node-a');
    saveSteeringDraft(storage, key, { draft: 'x', pendingRetry: null });
    expect(storage.getItem(key)).not.toBeNull();
    saveSteeringDraft(storage, key, { draft: '', pendingRetry: null });
    expect(storage.getItem(key)).toBeNull();
  });

  test('missing or corrupt entries reset to empty', () => {
    const storage = memoryStorage();
    const key = steeringDraftStorageKey('run-1', 'node-a');
    expect(loadSteeringDraft(storage, key)).toEqual({ draft: '', pendingRetry: null });
    storage.setItem(key, 'not-json{');
    expect(loadSteeringDraft(storage, key)).toEqual({ draft: '', pendingRetry: null });
    storage.setItem(key, JSON.stringify({ draft: 7, pendingRetry: 'nope' }));
    expect(loadSteeringDraft(storage, key)).toEqual({ draft: '', pendingRetry: null });
    storage.setItem(key, JSON.stringify({ draft: 'only' }));
    expect(loadSteeringDraft(storage, key)).toEqual({ draft: 'only', pendingRetry: null });
  });
});

describe('wording', () => {
  test('band headers are lowercase `queued · n` / `will send · n`', () => {
    expect(queueBandHeader(1)).toBe('queued · 1');
    expect(queueBandHeader(3)).toBe('queued · 3');
    expect(willSendBandHeader(1)).toBe('will send · 1');
    expect(willSendBandHeader(3)).toBe('will send · 3');
  });

  test('list labels are `Queued messages, n` and `Will send, n`', () => {
    expect(queueListLabel(2)).toBe('Queued messages, 2');
    expect(willSendListLabel(2)).toBe('Will send, 2');
  });

  test('accessible name starts with Queue and carries shortcut + count', () => {
    expect(queueButtonAccessibleName(0)).toBe('Queue · Cmd/Ctrl+Enter to send · 0 messages queued');
    expect(queueButtonAccessibleName(1)).toBe('Queue · Cmd/Ctrl+Enter to send · 1 message queued');
    expect(queueButtonAccessibleName(4)).toBe('Queue · Cmd/Ctrl+Enter to send · 4 messages queued');
  });

  test('Send now accessible name starts with Send now and carries shortcut + count', () => {
    expect(sendNowButtonAccessibleName(0)).toBe(
      'Send now · Cmd/Ctrl+Enter to send · 0 messages will send'
    );
    expect(sendNowButtonAccessibleName(1)).toBe(
      'Send now · Cmd/Ctrl+Enter to send · 1 message will send'
    );
    expect(sendNowButtonAccessibleName(2)).toBe(
      'Send now · Cmd/Ctrl+Enter to send · 2 messages will send'
    );
  });

  test('singular/plural announcement wording', () => {
    expect(queuedCountPhrase(1)).toBe('1 message queued');
    expect(queuedCountPhrase(2)).toBe('2 messages queued');
    expect(willSendCountPhrase(1)).toBe('1 message will send');
    expect(willSendCountPhrase(2)).toBe('2 messages will send');
  });

  test('static copy constants', () => {
    expect(STEERING_SEND_HINT).toBe('Cmd/Ctrl+Enter to send · this tab only');
    expect(STEERING_DETACHED_DISCLOSURE).toBe(
      'not steerable here · this run was started detached, so its live session is not in this process'
    );
    expect(STEERING_SEND_FAILED_MESSAGE).toBe("couldn't send · back in the queue");
    expect(STEERING_INTERRUPT_FAILED_MESSAGE).toBe("couldn't interrupt · try again");
    expect(STEERING_INTERRUPT_DISCLOSURE).toBe(
      'stopped after the last completed tool call · files already written stay written'
    );
    expect(STEERING_AGENT_INTERRUPTING).toBe('agent interrupting');
    expect(STEERING_AGENT_IDLE).toBe('agent idle · Send now delivers');
    expect(STEERING_AGENT_GENERATING).toBe('agent generating');
  });

  test('finished-iteration disclosure and Go label match the ratified copy', () => {
    expect(finishedIterationDisclosure(2)).toBe(
      'reading a finished iteration · the agent is working in iteration 2'
    );
    expect(goToIterationLabel(2)).toBe('Go to iteration 2');
    expect(finishedIterationDisclosure(11)).toBe(
      'reading a finished iteration · the agent is working in iteration 11'
    );
    expect(goToIterationLabel(11)).toBe('Go to iteration 11');
  });
});

describe('toSteeringRequestError', () => {
  test('parses the nested body out of a fetchJSON-style error message', () => {
    const body = JSON.stringify({
      success: false,
      error: { code: 'not_steerable_here', message: 'No live steering session' },
    });
    const error = Object.assign(new Error(`API error 422 (/api/x): ${body}`), { status: 422 });
    const normalized = toSteeringRequestError(error);
    expect(normalized).toBeInstanceOf(SteeringRequestError);
    expect(normalized.status).toBe(422);
    expect(normalized.code).toBe('not_steerable_here');
    expect(normalized.message).toBe('No live steering session');
  });

  test('parses the console HttpError bodySnippet field', () => {
    const body = JSON.stringify({
      success: false,
      error: { code: 'node_finished', message: 'Workflow node is finished' },
    });
    const error = Object.assign(new Error('API error 409 (/api/x): ...'), {
      status: 409,
      bodySnippet: body,
    });
    const normalized = toSteeringRequestError(error);
    expect(normalized.code).toBe('node_finished');
    expect(normalized.message).toBe('Workflow node is finished');
  });

  test('unparseable body keeps status with a generic message', () => {
    const error = Object.assign(new Error('API error 500 (/api/x): <html>'), { status: 500 });
    const normalized = toSteeringRequestError(error);
    expect(normalized.status).toBe(500);
    expect(normalized.code).toBeNull();
    expect(normalized.message).toBe('Request failed (500)');
  });

  test('transport-level failure reports the ambiguous copy', () => {
    const normalized = toSteeringRequestError(new TypeError('fetch failed'));
    expect(normalized.status).toBe(0);
    expect(normalized.code).toBeNull();
    expect(normalized.message).toBe(STEERING_SEND_FAILED_MESSAGE);
  });

  test('interrupt callers pass their own ambiguous copy', () => {
    const normalized = toSteeringRequestError(
      new TypeError('fetch failed'),
      STEERING_INTERRUPT_FAILED_MESSAGE
    );
    expect(normalized.message).toBe("couldn't interrupt · try again");
  });

  test('an existing SteeringRequestError passes through', () => {
    const error = new SteeringRequestError(422, 'not_steerable_here', 'detached');
    expect(toSteeringRequestError(error)).toBe(error);
  });
});

describe('toSteeringRefusal', () => {
  test('maps typed errors to a code/message refusal', () => {
    expect(toSteeringRefusal(new SteeringRequestError(409, 'node_finished', 'done'))).toEqual({
      code: 'node_finished',
      message: 'done',
    });
    expect(toSteeringRefusal(new Error('offline'))).toEqual({
      code: null,
      message: STEERING_SEND_FAILED_MESSAGE,
    });
    expect(toSteeringRefusal(new Error('offline'), STEERING_INTERRUPT_FAILED_MESSAGE)).toEqual({
      code: null,
      message: "couldn't interrupt · try again",
    });
  });
});

// ---------------------------------------------------------------------------
// Story 2.9 (#189) — shared queue reconciliation: queueGeneration,
// applyQueueSnapshot, focusTargetAfterSnapshot, startQueuePolling.
// ---------------------------------------------------------------------------

function receipt(messageId: string, message: string): LocalSentReceipt {
  return { messageId, message, state: 'queued' };
}

function stateWith(
  sent: readonly LocalSentReceipt[],
  overrides?: Partial<SteeringDockState>
): SteeringDockState {
  return { ...createSteeringDockState(), sent, ...overrides };
}

describe('queueGeneration', () => {
  test('starts at 0', () => {
    expect(createSteeringDockState().queueGeneration).toBe(0);
  });

  test('every resolved send increments, including an idempotent receipt replay', () => {
    const begun = beginGuidanceSubmission(createSteeringDockState(), 'one');
    const first = resolveGuidanceSuccess(begun.state, { message_id: begun.messageId });
    expect(first.queueGeneration).toBe(1);
    // A replayed 200 for the same id dedupes the row but still bumps — the
    // server confirmed the mutation again.
    const replayed = resolveGuidanceSuccess(
      { ...first, pendingRetry: { messageId: begun.messageId, message: 'one' } },
      { message_id: begun.messageId }
    );
    expect(replayed.queueGeneration).toBe(2);
    expect(replayed.sent).toHaveLength(1);
  });

  test('a matching withdraw success increments even when a snapshot already removed the row', () => {
    const state = stateWith([receipt('a', 'alpha')], { withdrawingMessageId: 'a' });
    // A snapshot removed 'a' while the withdraw was in flight — sent is
    // already empty but the resolved mutation still counts.
    const afterSnapshot = { ...state, sent: [] as readonly LocalSentReceipt[] };
    const resolved = resolveWithdrawSuccess(afterSnapshot, 'a');
    expect(resolved.queueGeneration).toBe(state.queueGeneration + 1);
    expect(resolved.sent).toEqual([]);
  });

  test('begin, failure, and stale no-op transitions never increment', () => {
    const begun = beginGuidanceSubmission(createSteeringDockState(), 'one');
    expect(begun.state.queueGeneration).toBe(0);

    const failed = resolveGuidanceFailure(begun.state, { code: null, message: 'lost' });
    expect(failed.queueGeneration).toBe(0);

    const withdrawBegun = beginWithdraw(stateWith([receipt('a', 'alpha')]), 'a');
    expect(withdrawBegun.queueGeneration).toBe(0);

    const withdrawFailed = resolveWithdrawFailure(withdrawBegun, 'a', {
      code: 'node_finished',
      message: 'done',
    });
    expect(withdrawFailed.queueGeneration).toBe(0);

    // Stale/mismatched completions are no-ops returning the same object.
    const idle = stateWith([receipt('a', 'alpha')]);
    expect(resolveWithdrawSuccess(idle, 'a')).toBe(idle);
  });
});
describe('applyQueueSnapshot', () => {
  test('replaces sent wholesale with the server-ordered receipts, including one this tab did not send', () => {
    const state = stateWith([receipt('a', 'alpha'), receipt('b', 'beta')]);
    const next = applyQueueSnapshot(
      state,
      {
        queued: [
          { message_id: 'b', message: 'beta' },
          { message_id: 'c', message: 'gamma-remote' },
        ],
      },
      0
    );
    expect(next.sent).toEqual([receipt('b', 'beta'), receipt('c', 'gamma-remote')]);
  });

  test('returns the identical state object when the snapshot is identical', () => {
    const state = stateWith([receipt('a', 'alpha'), receipt('b', 'beta')], {
      sendInFlight: true,
      pendingRetry: { messageId: 'p', message: 'wip' },
      refusal: { code: 'stale', message: 'old' },
      withdrawingMessageId: 'a',
    });
    const next = applyQueueSnapshot(
      state,
      {
        queued: [
          { message_id: 'a', message: 'alpha' },
          { message_id: 'b', message: 'beta' },
        ],
      },
      0
    );
    expect(next).toBe(state);
  });

  test('a stale generation returns the identical state and preserves the queue', () => {
    const state = stateWith([receipt('a', 'alpha')], { queueGeneration: 3 });
    // The snapshot was captured at generation 2 — a local mutation resolved
    // since, so the read must not resurrect 'b' or drop 'a'.
    const next = applyQueueSnapshot(
      state,
      {
        queued: [
          { message_id: 'b', message: 'beta' },
          { message_id: 'a', message: 'alpha' },
        ],
      },
      2
    );
    expect(next).toBe(state);
    expect(next.sent).toEqual([receipt('a', 'alpha')]);
  });

  test('preserves in-flight send, interrupt/Send-now fields, pending retry, refusal, and the active withdraw id', () => {
    const state = stateWith([receipt('a', 'alpha')], {
      sendInFlight: true,
      interruptInFlight: true,
      inFlightBatch: [receipt('x', 'batch')],
      subState: 'idle-after-interrupt',
      notice: 'agent interrupting',
      pendingRetry: { messageId: 'p', message: 'wip' },
      refusal: { code: 'node_finished', message: 'done' },
      withdrawingMessageId: 'a',
      queueGeneration: 5,
    });
    const next = applyQueueSnapshot(state, { queued: [{ message_id: 'b', message: 'beta' }] }, 5);
    expect(next.sent).toEqual([receipt('b', 'beta')]);
    expect(next.sendInFlight).toBe(true);
    expect(next.interruptInFlight).toBe(true);
    expect(next.inFlightBatch).toEqual([receipt('x', 'batch')]);
    expect(next.subState).toBe('idle-after-interrupt');
    expect(next.notice).toBe('agent interrupting');
    expect(next.pendingRetry).toEqual({ messageId: 'p', message: 'wip' });
    expect(next.refusal).toEqual({ code: 'node_finished', message: 'done' });
    expect(next.withdrawingMessageId).toBe('a');
    expect(next.queueGeneration).toBe(5);
  });

  test('a snapshot that removes the actively-withdrawing row keeps the id so its success still resolves safely', () => {
    const state = stateWith([receipt('a', 'alpha'), receipt('b', 'beta')], {
      withdrawingMessageId: 'a',
    });
    const afterSnapshot = applyQueueSnapshot(
      state,
      { queued: [{ message_id: 'b', message: 'beta' }] },
      0
    );
    expect(afterSnapshot.sent).toEqual([receipt('b', 'beta')]);
    expect(afterSnapshot.withdrawingMessageId).toBe('a');
    // The withdraw 200 lands after the row already vanished — still a clean
    // resolution: clears the id and bumps the generation.
    const resolved = resolveWithdrawSuccess(afterSnapshot, 'a');
    expect(resolved.withdrawingMessageId).toBeNull();
    expect(resolved.queueGeneration).toBe(1);
    expect(resolved.sent).toEqual([receipt('b', 'beta')]);
  });

  test('a snapshot containing the in-flight send id dedupes with its later resolution', () => {
    const state = stateWith([receipt('a', 'alpha')], {
      sendInFlight: true,
      pendingRetry: { messageId: 'p', message: 'pending' },
    });
    // The server already accepted the send; its row arrives via the snapshot
    // before the POST response.
    const afterSnapshot = applyQueueSnapshot(
      state,
      {
        queued: [
          { message_id: 'a', message: 'alpha' },
          { message_id: 'p', message: 'pending' },
        ],
      },
      0
    );
    expect(afterSnapshot.sent).toEqual([receipt('a', 'alpha'), receipt('p', 'pending')]);
    const resolved = resolveGuidanceSuccess(afterSnapshot, { message_id: 'p' });
    expect(resolved.sent).toHaveLength(2);
    expect(resolved.sent.filter(entry => entry.messageId === 'p')).toHaveLength(1);
  });
});

describe('focusTargetAfterSnapshot', () => {
  test('returns null when nothing is focused or the focused row survived', () => {
    expect(focusTargetAfterSnapshot(['a', 'b'], ['a', 'b'], 'b')).toBeNull();
    // Reordered but still present — focus stays put, no DOM move needed.
    expect(focusTargetAfterSnapshot(['a', 'b'], ['b', 'a'], 'b')).toBeNull();
    expect(focusTargetAfterSnapshot(['a'], [], null)).toBeNull();
  });

  test('a removed row moves focus to the next surviving row, else the previous', () => {
    expect(focusTargetAfterSnapshot(['a', 'b', 'c'], ['a', 'c'], 'b')).toEqual({
      kind: 'delete',
      messageId: 'c',
    });
    expect(focusTargetAfterSnapshot(['a', 'b', 'c'], ['a', 'b'], 'c')).toEqual({
      kind: 'delete',
      messageId: 'b',
    });
  });

  test('multiple removals scan to the nearest survivor in each direction', () => {
    // Focused 'b'; 'b' and 'c' both gone — next survivor is 'd'.
    expect(focusTargetAfterSnapshot(['a', 'b', 'c', 'd'], ['a', 'd'], 'b')).toEqual({
      kind: 'delete',
      messageId: 'd',
    });
    // Focused 'c'; everything after gone — previous survivor is 'a'.
    expect(focusTargetAfterSnapshot(['a', 'b', 'c'], ['a'], 'c')).toEqual({
      kind: 'delete',
      messageId: 'a',
    });
  });

  test('an only-row removal and an unknown focused id resolve to the field — never body', () => {
    expect(focusTargetAfterSnapshot(['a'], [], 'a')).toEqual({ kind: 'field' });
    expect(focusTargetAfterSnapshot(['a', 'b'], ['a'], 'missing')).toEqual({ kind: 'field' });
  });
});

describe('startQueuePolling', () => {
  interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  }

  function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  interface FakeClock {
    setTimer: typeof setTimeout;
    clearTimer: typeof clearTimeout;
    pending: Map<number, { fn: () => void; ms: number }>;
    runNext: () => void;
  }

  function fakeClock(): FakeClock {
    let nextHandle = 0;
    const pending = new Map<number, { fn: () => void; ms: number }>();
    const setTimer = ((handler: TimerHandler, timeout?: number): number => {
      const handle = ++nextHandle;
      const fn: () => void =
        typeof handler === 'function' ? (handler as () => void) : (): void => undefined;
      pending.set(handle, { fn, ms: timeout ?? 0 });
      return handle;
    }) as typeof setTimeout;
    const clearTimer = ((handle: unknown): void => {
      pending.delete(handle as number);
    }) as typeof clearTimeout;
    const runNext = (): void => {
      const handle = pending.keys().next().value;
      if (handle === undefined) throw new Error('no scheduled timer');
      const entry = pending.get(handle);
      if (entry === undefined) throw new Error('no scheduled timer');
      pending.delete(handle);
      entry.fn();
    };
    return { setTimer, clearTimer, pending, runNext };
  }

  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  function pollHarness(clock: FakeClock, onSnapshot: (gen: number) => void, initialGeneration = 0) {
    const reads: Deferred<{ queued: readonly QueuedGuidanceRow[] }>[] = [];
    let generation = initialGeneration;
    const stop = startQueuePolling({
      read: () => {
        const d = deferred<{ queued: readonly QueuedGuidanceRow[] }>();
        reads.push(d);
        return d.promise;
      },
      currentGeneration: () => generation,
      onSnapshot: (_snapshot, generationAtRequest) => {
        onSnapshot(generationAtRequest);
      },
      intervalMs: 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    return {
      reads,
      stop,
      setGeneration: (g: number): void => {
        generation = g;
      },
    };
  }

  test('fires the first read immediately and schedules the next only after it settles', async () => {
    const clock = fakeClock();
    const snapshots: number[] = [];
    const { reads, stop, setGeneration } = pollHarness(
      clock,
      gen => {
        snapshots.push(gen);
      },
      7
    );
    try {
      // Immediate first read — before any timer could have fired.
      expect(reads).toHaveLength(1);
      expect(clock.pending.size).toBe(0);

      reads[0].resolve({ queued: [{ message_id: 'a', message: 'alpha' }] });
      await flush();
      expect(snapshots).toEqual([7]);
      expect(clock.pending.size).toBe(1);

      // The scheduled tick fires the second read; it carries whatever the
      // generation is at fire time.
      setGeneration(9);
      clock.runNext();
      expect(reads).toHaveLength(2);
      // While the request is in flight nothing new is scheduled: no overlap.
      expect(clock.pending.size).toBe(0);
      reads[1].resolve({ queued: [] });
      await flush();
      expect(snapshots).toEqual([7, 9]);
    } finally {
      stop();
    }
  });

  test('retries 422, transport (0), and 5xx failures without calling onSnapshot', async () => {
    const clock = fakeClock();
    const snapshots: unknown[] = [];
    const { reads, stop } = pollHarness(clock, gen => {
      snapshots.push(gen);
    });
    try {
      for (const error of [
        new SteeringRequestError(422, 'not_steerable_here', 'detached'),
        new Error('offline'),
        new SteeringRequestError(500, 'internal_error', 'oops'),
        new SteeringRequestError(503, 'internal_error', 'busy'),
      ]) {
        const attempt = reads.length;
        reads[attempt - 1].reject(error);
        await flush();
        expect(snapshots).toHaveLength(0);
        // Retryable: the poll rescheduled instead of stopping.
        expect(clock.pending.size).toBe(1);
        clock.runNext();
        expect(reads.length).toBe(attempt + 1);
      }
    } finally {
      stop();
    }
  });

  test('a synchronous throw from read is normalized and retried like a rejection', () => {
    const clock = fakeClock();
    const snapshots: unknown[] = [];
    let calls = 0;
    const stop = startQueuePolling({
      read: () => {
        calls++;
        throw new SteeringRequestError(422, 'not_steerable_here', 'detached');
      },
      currentGeneration: () => 0,
      onSnapshot: snapshot => {
        snapshots.push(snapshot);
      },
      intervalMs: 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    try {
      expect(calls).toBe(1);
      expect(snapshots).toHaveLength(0);
      expect(clock.pending.size).toBe(1);
      clock.runNext();
      expect(calls).toBe(2);
    } finally {
      stop();
    }
  });

  test('stops on 400, 401, 403, 404, and 409 — no reschedule, no snapshot', async () => {
    for (const status of [400, 401, 403, 404, 409]) {
      const clock = fakeClock();
      const snapshots: unknown[] = [];
      const { reads, stop } = pollHarness(clock, gen => {
        snapshots.push(gen);
      });
      reads[0].reject(new SteeringRequestError(status, 'code', 'msg'));
      await flush();
      expect(snapshots).toHaveLength(0);
      expect(clock.pending.size).toBe(0);
      stop();
    }
  });

  test('onError receives the normalized error once per failed read before retry/stop', async () => {
    const clock = fakeClock();
    const errors: SteeringRequestError[] = [];
    const reads: Deferred<{ queued: readonly QueuedGuidanceRow[] }>[] = [];
    const stop = startQueuePolling({
      read: () => {
        const d = deferred<{ queued: readonly QueuedGuidanceRow[] }>();
        reads.push(d);
        return d.promise;
      },
      currentGeneration: () => 0,
      onSnapshot: () => undefined,
      onError: error => {
        errors.push(error);
      },
      intervalMs: 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    try {
      reads[0].reject(new SteeringRequestError(422, 'not_steerable_here', 'detached'));
      await flush();
      expect(errors).toHaveLength(1);
      expect(errors[0]?.status).toBe(422);
      expect(errors[0]?.code).toBe('not_steerable_here');
      expect(clock.pending.size).toBe(1);

      clock.runNext();
      reads[1].reject(new SteeringRequestError(409, 'node_finished', 'done'));
      await flush();
      expect(errors).toHaveLength(2);
      expect(errors[1]?.status).toBe(409);
      expect(clock.pending.size).toBe(0);
    } finally {
      stop();
    }
  });

  test('omitted onError keeps retry/stop behavior identical', async () => {
    const clock = fakeClock();
    const snapshots: unknown[] = [];
    const { reads, stop } = pollHarness(clock, gen => {
      snapshots.push(gen);
    });
    try {
      reads[0].reject(new SteeringRequestError(422, 'not_steerable_here', 'detached'));
      await flush();
      expect(snapshots).toHaveLength(0);
      expect(clock.pending.size).toBe(1);
      clock.runNext();
      reads[1].resolve({ queued: [{ message_id: 'a', message: 'alpha' }] });
      await flush();
      expect(snapshots).toEqual([0]);
    } finally {
      stop();
    }
  });

  test('onError fires for a synchronous throw and still retries 422', () => {
    const clock = fakeClock();
    const errors: SteeringRequestError[] = [];
    let calls = 0;
    const stop = startQueuePolling({
      read: () => {
        calls++;
        throw new SteeringRequestError(422, 'not_steerable_here', 'detached');
      },
      currentGeneration: () => 0,
      onSnapshot: () => undefined,
      onError: error => {
        errors.push(error);
      },
      intervalMs: 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    try {
      expect(calls).toBe(1);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.status).toBe(422);
      expect(clock.pending.size).toBe(1);
      clock.runNext();
      expect(calls).toBe(2);
      expect(errors).toHaveLength(2);
    } finally {
      stop();
    }
  });

  test('cleanup aborts the in-flight request, clears the timer, and suppresses late settles', async () => {
    // First prove cleanup removes a timer that is waiting between reads.
    const timerClock = fakeClock();
    const timerReads: Deferred<{ queued: readonly QueuedGuidanceRow[] }>[] = [];
    const stopBetweenReads = startQueuePolling({
      read: () => {
        const d = deferred<{ queued: readonly QueuedGuidanceRow[] }>();
        timerReads.push(d);
        return d.promise;
      },
      currentGeneration: () => 0,
      onSnapshot: () => undefined,
      intervalMs: 1000,
      setTimer: timerClock.setTimer,
      clearTimer: timerClock.clearTimer,
    });
    timerReads[0].resolve({ queued: [] });
    await flush();
    expect(timerClock.pending.size).toBe(1);
    stopBetweenReads();
    expect(timerClock.pending.size).toBe(0);

    // Then prove cleanup aborts an active read and suppresses late settlement.
    const clock = fakeClock();
    const signals: AbortSignal[] = [];
    const snapshots: unknown[] = [];
    const reads: Deferred<{ queued: readonly QueuedGuidanceRow[] }>[] = [];
    const stop = startQueuePolling({
      read: signal => {
        signals.push(signal);
        const d = deferred<{ queued: readonly QueuedGuidanceRow[] }>();
        reads.push(d);
        return d.promise;
      },
      currentGeneration: () => 0,
      onSnapshot: snapshot => {
        snapshots.push(snapshot);
      },
      intervalMs: 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    // Settle the first read so a timer is pending, then stop mid-second-read.
    reads[0].resolve({ queued: [] });
    await flush();
    clock.runNext();
    expect(reads).toHaveLength(2);
    stop();
    expect(signals[1].aborted).toBe(true);

    // A late resolve is fully suppressed — no snapshot, no reschedule.
    reads[1].resolve({ queued: [{ message_id: 'a', message: 'alpha' }] });
    await flush();
    expect(snapshots).toHaveLength(1);
    expect(clock.pending.size).toBe(0);
    expect(reads).toHaveLength(2);

    // A late reject is suppressed the same way — no retry after abort.
    const clock2 = fakeClock();
    const reads2: Deferred<{ queued: readonly QueuedGuidanceRow[] }>[] = [];
    const stop2 = startQueuePolling({
      read: () => {
        const d = deferred<{ queued: readonly QueuedGuidanceRow[] }>();
        reads2.push(d);
        return d.promise;
      },
      currentGeneration: () => 0,
      onSnapshot: () => undefined,
      intervalMs: 1000,
      setTimer: clock2.setTimer,
      clearTimer: clock2.clearTimer,
    });
    stop2();
    reads2[0].reject(new SteeringRequestError(500, 'internal_error', 'oops'));
    await flush();
    expect(clock2.pending.size).toBe(0);
    expect(reads2).toHaveLength(1);
  });
});
