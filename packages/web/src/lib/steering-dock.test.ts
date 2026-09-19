import { describe, expect, test } from 'bun:test';

import {
  beginGuidanceSubmission,
  beginInterrupt,
  beginSendNow,
  canSubmitGuidance,
  createSteeringDockState,
  isQueueShortcut,
  loadSteeringDraft,
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
  saveSteeringDraft,
  sendNowButtonAccessibleName,
  steeringAgentMode,
  steeringBlockedReason,
  steeringDockMode,
  steeringDraftStorageKey,
  syncProjectedSubState,
  STEERING_AGENT_GENERATING,
  STEERING_AGENT_IDLE,
  STEERING_AGENT_INTERRUPTING,
  STEERING_ASK_BLOCKED_REASON,
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

  test('begin snapshots the band into inFlightBatch and clears it optimistically', () => {
    const state = idleWithReceipts(['first', 'second']);
    const begun = beginSendNow(state, 'redirect now', newId);
    expect(begun.state.sent).toEqual([]);
    expect(begun.state.inFlightBatch?.map(entry => entry.message)).toEqual(['first', 'second']);
    expect(begun.state.sendInFlight).toBe(true);
    expect(begun.state.pendingRetry).toEqual({
      messageId: begun.messageId,
      message: 'redirect now',
    });
  });

  test('success discards the batch, derives generating, announces once', () => {
    const state = idleWithReceipts(['first']);
    const begun = beginSendNow(state, 'redirect now', newId);
    const next = resolveSendNowSuccess(begun.state, { message_id: begun.messageId });
    expect(next.sent).toEqual([]);
    expect(next.inFlightBatch).toBeNull();
    expect(next.pendingRetry).toBeNull();
    expect(next.subState).toBe('generating');
    expect(next.notice).toBe('agent generating');
  });

  test('a replayed success after settlement never drains twice', () => {
    const state = idleWithReceipts(['first']);
    const begun = beginSendNow(state, 'redirect now', newId);
    const settled = resolveSendNowSuccess(begun.state, { message_id: begun.messageId });
    const replay = resolveSendNowSuccess(settled, { message_id: begun.messageId });
    expect(replay).toBe(settled);
  });

  test('failure restores old then new items and retains the stable retry id', () => {
    const state = idleWithReceipts(['first', 'second']);
    const begun = beginSendNow(state, 'redirect now', newId);
    const failed = resolveSendNowFailure(begun.state, {
      code: null,
      message: STEERING_SEND_FAILED_MESSAGE,
    });
    expect(failed.sent.map(entry => entry.message)).toEqual(['first', 'second']);
    expect(failed.inFlightBatch).toBeNull();
    expect(failed.sendInFlight).toBe(false);
    expect(failed.subState).toBe('idle-after-interrupt');
    expect(failed.refusal?.message).toBe("couldn't send · back in the queue");

    const retried = beginSendNow(failed, 'redirect now', newId);
    expect(retried.messageId).toBe(begun.messageId);
    expect(retried.state.inFlightBatch?.map(entry => entry.message)).toEqual(['first', 'second']);
  });

  test('a terminal projection supersedes an idle send-now state', () => {
    const state = idleWithReceipts(['first']);
    const begun = beginSendNow(state, 'redirect now', newId);
    const failed = resolveSendNowFailure(begun.state, { code: null, message: 'lost' });
    const synced = syncProjectedSubState(failed, 'generating');
    expect(synced.subState).toBe('generating');
    expect(synced.notice).toBe('agent generating');
    expect(synced.sent).toHaveLength(1);
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
