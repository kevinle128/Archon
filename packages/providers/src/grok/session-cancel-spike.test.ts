import { describe, expect, test } from 'bun:test';

import { classifyCancelVerdict, type SessionCancelTrialEvidence } from './session-cancel-spike';

function baseEvidence(
  overrides: Partial<SessionCancelTrialEvidence> = {}
): SessionCancelTrialEvidence {
  return {
    grokVersion: 'grok 1.0.41',
    initializeSucceeded: true,
    sessionNewSucceeded: true,
    sessionId: 'session-1',
    permissionRequestsAutoApproved: 0,
    serverRequestsSeen: [],
    descendantPidCaptured: true,
    descendantAliveBeforeCancel: true,
    descendantInAgentTree: true,
    cancelSent: true,
    promptSettledAfterCancel: true,
    promptStopReason: 'cancelled',
    cancelToSettlementMs: 20,
    descendantsAliveAfterCancel: false,
    redirectPromptSettled: true,
    redirectProvedContext: true,
    crossProcessResumeMethod: 'session/load',
    crossProcessResumeSettled: true,
    crossProcessResumeProvedContext: true,
    crossProcessResumeError: null,
    observedNotificationMethods: [],
    sessionUpdateKindsSeen: [],
    failure: null,
    ...overrides,
  };
}

describe('classifyCancelVerdict', () => {
  test('clean-stop on the real observed shape: descendant confirmed alive, then reaped', () => {
    expect(classifyCancelVerdict(baseEvidence())).toBe('clean-stop');
  });

  test('descendant-leak when the fingerprinted descendant survives the cancel', () => {
    expect(classifyCancelVerdict(baseEvidence({ descendantsAliveAfterCancel: true }))).toBe(
      'descendant-leak'
    );
  });

  test('inconclusive when the trial itself failed', () => {
    expect(classifyCancelVerdict(baseEvidence({ failure: 'boom' }))).toBe('inconclusive');
  });

  test('inconclusive when the descendant pid file never appeared', () => {
    expect(
      classifyCancelVerdict(
        baseEvidence({ descendantPidCaptured: false, descendantAliveBeforeCancel: null })
      )
    ).toBe('inconclusive');
  });

  test('inconclusive when the descendant was not confirmed alive before cancel (race, not proof)', () => {
    expect(classifyCancelVerdict(baseEvidence({ descendantAliveBeforeCancel: false }))).toBe(
      'inconclusive'
    );
  });

  test('inconclusive when the prompt never settles after cancel', () => {
    expect(classifyCancelVerdict(baseEvidence({ promptSettledAfterCancel: false }))).toBe(
      'inconclusive'
    );
  });

  test('a cross-process resume problem alone does not poison the cancel verdict', () => {
    expect(
      classifyCancelVerdict(
        baseEvidence({
          crossProcessResumeMethod: 'none',
          crossProcessResumeSettled: false,
          crossProcessResumeProvedContext: false,
          crossProcessResumeError: 'cross-process resume failed: method not found',
        })
      )
    ).toBe('clean-stop');
  });
});
