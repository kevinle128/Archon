import { describe, expect, test } from 'bun:test';

import {
  beginGuidanceSubmission,
  beginWithdraw,
  canSubmitGuidance,
  createSteeringDockState,
  deleteButtonAccessibleName,
  isQueueShortcut,
  loadSteeringDraft,
  nextFocusAfterRemoval,
  queueBandHeader,
  queueButtonAccessibleName,
  queueListLabel,
  queuedCountPhrase,
  resolveGuidanceFailure,
  resolveGuidanceSuccess,
  resolveWithdrawFailure,
  resolveWithdrawSuccess,
  saveSteeringDraft,
  steeringBlockedReason,
  steeringDockMode,
  steeringDraftStorageKey,
  STEERING_ASK_BLOCKED_REASON,
  STEERING_DELETE_LABEL,
  STEERING_DETACHED_DISCLOSURE,
  STEERING_SEND_FAILED_MESSAGE,
  STEERING_SEND_HINT,
  SteeringSendError,
  toSteeringRefusal,
  toSteeringSendError,
  type LocalSentReceipt,
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
  }
): string {
  return steeringDockMode({
    rowStatus,
    live: overrides?.live ?? true,
    hasPendingAsk: overrides?.hasPendingAsk ?? false,
    refusal: overrides?.refusal ?? null,
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

describe('canSubmitGuidance', () => {
  test.each([
    ['   ', false],
    ['\n\t ', false],
    ['', false],
    ['x', true],
    ['  keep the padding  ', true],
  ])('draft %j submittable=%s', (draft, expected) => {
    expect(canSubmitGuidance({ mode: 'composer', inFlight: false, draft })).toBe(expected);
  });

  test('in-flight or non-composer modes refuse', () => {
    expect(canSubmitGuidance({ mode: 'composer', inFlight: true, draft: 'x' })).toBe(false);
    for (const mode of ['hidden', 'blocked', 'detached'] as const) {
      expect(canSubmitGuidance({ mode, inFlight: false, draft: 'x' })).toBe(false);
    }
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

  test('begin stamps one uuid and marks the request in flight', () => {
    const begun = beginGuidanceSubmission(createSteeringDockState(), 'hello', newId);
    expect(begun.messageId).toBe('id-1');
    expect(begun.state.inFlight).toBe(true);
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
    const next = resolveGuidanceSuccess(begun.state, { message_id: begun.messageId });
    expect(next.sent).toEqual([{ messageId: begun.messageId, message: 'first', state: 'queued' }]);
    expect(next.inFlight).toBe(false);
    expect(next.pendingRetry).toBeNull();
    expect(next.refusal).toBeNull();
  });

  test('two successful sends keep acceptance order', () => {
    let state: SteeringDockState = createSteeringDockState();
    const first = beginGuidanceSubmission(state, 'alpha', newId);
    state = resolveGuidanceSuccess(first.state, { message_id: first.messageId });
    const second = beginGuidanceSubmission(state, 'beta', newId);
    state = resolveGuidanceSuccess(second.state, { message_id: second.messageId });
    expect(state.sent.map(entry => entry.message)).toEqual(['alpha', 'beta']);
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
    expect(failed.inFlight).toBe(false);
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
    expect(begun.inFlight).toBe(state.inFlight);
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
  test('band header is lowercase `queued · n`', () => {
    expect(queueBandHeader(1)).toBe('queued · 1');
    expect(queueBandHeader(3)).toBe('queued · 3');
  });

  test('list label is `Queued messages, n`', () => {
    expect(queueListLabel(2)).toBe('Queued messages, 2');
  });

  test('accessible name starts with Queue and carries shortcut + count', () => {
    expect(queueButtonAccessibleName(0)).toBe('Queue · Cmd/Ctrl+Enter to send · 0 messages queued');
    expect(queueButtonAccessibleName(1)).toBe('Queue · Cmd/Ctrl+Enter to send · 1 message queued');
    expect(queueButtonAccessibleName(4)).toBe('Queue · Cmd/Ctrl+Enter to send · 4 messages queued');
  });

  test('singular/plural announcement wording', () => {
    expect(queuedCountPhrase(1)).toBe('1 message queued');
    expect(queuedCountPhrase(2)).toBe('2 messages queued');
  });

  test('static copy constants', () => {
    expect(STEERING_SEND_HINT).toBe('Cmd/Ctrl+Enter to send · this tab only');
    expect(STEERING_DETACHED_DISCLOSURE).toBe(
      'not steerable here · this run was started detached, so its live session is not in this process'
    );
    expect(STEERING_SEND_FAILED_MESSAGE).toBe("couldn't send · back in the queue");
  });
});

describe('toSteeringSendError', () => {
  test('parses the nested body out of a fetchJSON-style error message', () => {
    const body = JSON.stringify({
      success: false,
      error: { code: 'not_steerable_here', message: 'No live steering session' },
    });
    const error = Object.assign(new Error(`API error 422 (/api/x): ${body}`), { status: 422 });
    const normalized = toSteeringSendError(error);
    expect(normalized).toBeInstanceOf(SteeringSendError);
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
    const normalized = toSteeringSendError(error);
    expect(normalized.code).toBe('node_finished');
    expect(normalized.message).toBe('Workflow node is finished');
  });

  test('unparseable body keeps status with a generic message', () => {
    const error = Object.assign(new Error('API error 500 (/api/x): <html>'), { status: 500 });
    const normalized = toSteeringSendError(error);
    expect(normalized.status).toBe(500);
    expect(normalized.code).toBeNull();
    expect(normalized.message).toBe('Request failed (500)');
  });

  test('transport-level failure reports the ambiguous copy', () => {
    const normalized = toSteeringSendError(new TypeError('fetch failed'));
    expect(normalized.status).toBe(0);
    expect(normalized.code).toBeNull();
    expect(normalized.message).toBe(STEERING_SEND_FAILED_MESSAGE);
  });

  test('an existing SteeringSendError passes through', () => {
    const error = new SteeringSendError(422, 'not_steerable_here', 'detached');
    expect(toSteeringSendError(error)).toBe(error);
  });
});

describe('toSteeringRefusal', () => {
  test('maps typed errors to a code/message refusal', () => {
    expect(toSteeringRefusal(new SteeringSendError(409, 'node_finished', 'done'))).toEqual({
      code: 'node_finished',
      message: 'done',
    });
    expect(toSteeringRefusal(new Error('offline'))).toEqual({
      code: null,
      message: STEERING_SEND_FAILED_MESSAGE,
    });
  });
});
