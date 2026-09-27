import { describe, expect, test } from 'bun:test';

import {
  classifyDeliveryAckVerdict,
  classifySoftInjectionVerdict,
  type SoftInjectionEvidence,
} from './soft-injection-spike';

function baseEvidence(overrides: Partial<SoftInjectionEvidence> = {}): SoftInjectionEvidence {
  return {
    sdkVersion: '0.3.209',
    model: 'haiku',
    sessionId: 'session-1',
    injectedUuidEchoed: false,
    echoedViaReplayMessage: false,
    echoMessageType: null,
    firstResultContainedMarker: false,
    resultCountAfterInjection: 1,
    genuinelyMidGeneration: true,
    streamInputResolved: true,
    streamInputError: null,
    postInjectionEventTypes: [],
    resultSeen: true,
    terminalReason: 'completed',
    failureCategory: null,
    ...overrides,
  };
}

describe('classifySoftInjectionVerdict', () => {
  test('verified only when exactly one result followed genuinely mid-generation injection', () => {
    expect(classifySoftInjectionVerdict(baseEvidence())).toBe('verified');
  });

  test('unverified on the real observed shape: streamInput() produced a second result', () => {
    expect(classifySoftInjectionVerdict(baseEvidence({ resultCountAfterInjection: 2 }))).toBe(
      'unverified'
    );
  });

  test('unverified when streamInput() itself threw', () => {
    expect(
      classifySoftInjectionVerdict(
        baseEvidence({ streamInputResolved: false, streamInputError: 'boom' })
      )
    ).toBe('unverified');
  });

  test('unverified when no further tokens streamed after injection (too-late injection)', () => {
    expect(classifySoftInjectionVerdict(baseEvidence({ genuinelyMidGeneration: false }))).toBe(
      'unverified'
    );
  });

  test('unverified when the experiment itself failed', () => {
    expect(classifySoftInjectionVerdict(baseEvidence({ failureCategory: 'timeout' }))).toBe(
      'unverified'
    );
  });
});

describe('classifyDeliveryAckVerdict', () => {
  test('verified only when the caller-stamped uuid was echoed back', () => {
    expect(classifyDeliveryAckVerdict(baseEvidence({ injectedUuidEchoed: true }))).toBe('verified');
  });

  test('unverified on the real observed shape: no message ever carried the injected uuid', () => {
    expect(classifyDeliveryAckVerdict(baseEvidence({ injectedUuidEchoed: false }))).toBe(
      'unverified'
    );
  });
});
