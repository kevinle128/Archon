import { describe, expect, test } from 'bun:test';

import { classifyInterjectVerdict, type AcpHandshakeEvidence } from './acp-handshake-spike';

function baseEvidence(overrides: Partial<AcpHandshakeEvidence> = {}): AcpHandshakeEvidence {
  return {
    grokVersion: 'grok 1.0.41',
    initializeSucceeded: true,
    sessionNewSucceeded: true,
    sessionId: 'session-1',
    promptAckSeen: true,
    sawSessionUpdateBeforeInterject: true,
    interjectAttempted: true,
    interjectSucceeded: false,
    interjectErrorCode: -32601,
    interjectErrorMessage: 'Method not found',
    underscoredInterjectAttempted: true,
    underscoredInterjectSucceeded: false,
    underscoredInterjectErrorCode: -32602,
    underscoredInterjectErrorMessage: 'Invalid params',
    observedNotificationMethods: [],
    failure: null,
    ...overrides,
  };
}

describe('classifyInterjectVerdict', () => {
  test('unverified on the real observed shape: method-not-found then invalid-params', () => {
    expect(classifyInterjectVerdict(baseEvidence())).toBe('unverified');
  });

  test('verified when the unprefixed method call succeeds', () => {
    expect(classifyInterjectVerdict(baseEvidence({ interjectSucceeded: true }))).toBe('verified');
  });

  test('verified when only the underscored fallback succeeds', () => {
    expect(classifyInterjectVerdict(baseEvidence({ underscoredInterjectSucceeded: true }))).toBe(
      'verified'
    );
  });

  test('unverified when the experiment itself failed', () => {
    expect(classifyInterjectVerdict(baseEvidence({ failure: 'boom' }))).toBe('unverified');
  });
});
