import { describe, expect, test } from 'bun:test';

import {
  classifyRpcSoftInjectionVerdict,
  classifyRpcStopVerdict,
  type RpcModeEvidence,
} from './rpc-mode-spike';

function baseEvidence(overrides: Partial<RpcModeEvidence> = {}): RpcModeEvidence {
  return {
    ompVersion: 'omp/18.1.21',
    readyFrameSeen: true,
    promptAckSeen: true,
    agentEndCount: 2,
    abort: {
      attempted: true,
      ackSeen: true,
      childExitedAfterAbort: false,
      redirectPromptAckSeen: true,
      redirectReachedAgentEnd: true,
      redirectProvedContext: true,
      samePid: true,
    },
    steer: {
      attempted: true,
      ackSeen: true,
      setInterruptModeAckSeen: true,
      agentEndCountAfterSteer: 1,
      toolOutcomeDisrupted: false,
      secondToolCallStillRan: false,
      sawTurnStartAfterSteer: false,
      steerLandedBeforeFirstAgentEnd: true,
    },
    observedEventTypes: [],
    failure: null,
    ...overrides,
  };
}

describe('classifyRpcStopVerdict', () => {
  test('verified only when abort is acked and the redirect proves same-session context on the same pid', () => {
    expect(classifyRpcStopVerdict(baseEvidence())).toBe('verified');
  });

  test('unverified on the real observed shape: abort response never acked', () => {
    expect(
      classifyRpcStopVerdict(baseEvidence({ abort: { ...baseEvidence().abort, ackSeen: false } }))
    ).toBe('unverified');
  });

  test('unverified when the redirect could not prove it kept turn 1 context', () => {
    expect(
      classifyRpcStopVerdict(
        baseEvidence({ abort: { ...baseEvidence().abort, redirectProvedContext: false } })
      )
    ).toBe('unverified');
  });

  test('unverified when the redirect landed on a different pid', () => {
    expect(
      classifyRpcStopVerdict(baseEvidence({ abort: { ...baseEvidence().abort, samePid: false } }))
    ).toBe('unverified');
  });

  test('unverified when the experiment itself failed', () => {
    expect(classifyRpcStopVerdict(baseEvidence({ failure: 'boom' }))).toBe('unverified');
  });
});

describe('classifyRpcSoftInjectionVerdict', () => {
  test('verified only when steer is acked, changes the in-flight plan, and stays inside one agent_end', () => {
    expect(classifyRpcSoftInjectionVerdict(baseEvidence())).toBe('verified');
  });

  test('unverified on the real observed shape: the already-planned second tool call still ran', () => {
    expect(
      classifyRpcSoftInjectionVerdict(
        baseEvidence({ steer: { ...baseEvidence().steer, secondToolCallStillRan: true } })
      )
    ).toBe('unverified');
  });

  test('unverified when steer produced more than one agent_end (a queued follow-up run, not one turn)', () => {
    expect(
      classifyRpcSoftInjectionVerdict(
        baseEvidence({ steer: { ...baseEvidence().steer, agentEndCountAfterSteer: 2 } })
      )
    ).toBe('unverified');
  });

  test('unverified when steer was never acked', () => {
    expect(
      classifyRpcSoftInjectionVerdict(
        baseEvidence({ steer: { ...baseEvidence().steer, ackSeen: false } })
      )
    ).toBe('unverified');
  });
});
