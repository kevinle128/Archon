import { describe, expect, test } from 'bun:test';

import { SoftInjectionLedger } from './soft-injection-ledger';
import type { TranscriptExecutionScope } from './schemas/node-execution';

const scope = { attempt_id: 'a', occurrence_id: 'o' } as unknown as TranscriptExecutionScope;

function makeLedger(hasDeliveryAck: boolean): {
  ledger: SoftInjectionLedger;
  events: string[];
} {
  const events: string[] = [];
  const store = {
    appendNodeMessage: (input: { metadata?: { message_id?: string } | null }) => {
      events.push(`row:${input.metadata?.message_id ?? '?'}`);
      return Promise.resolve({});
    },
    markSteeringMessageDelivered: (_run: string, _node: string, id: string) => {
      events.push(`delivered:${id}`);
      return Promise.resolve();
    },
    revertSteeringSoftInjectionClaim: (_run: string, _node: string, id: string) => {
      events.push(`revert:${id}`);
      return Promise.resolve();
    },
  };
  // The ledger only touches these three store methods.
  const ledger = new SoftInjectionLedger(
    store as unknown as ConstructorParameters<typeof SoftInjectionLedger>[0],
    'run',
    'node',
    () => scope,
    hasDeliveryAck
  );
  return { ledger, events };
}

const request = (id: string): { messageId: string; text: string } => ({
  messageId: id,
  text: `text ${id}`,
});

describe('SoftInjectionLedger with a delivery acknowledgement', () => {
  test('records the row and delivers only on the echo of a tracked id', async () => {
    const { ledger, events } = makeLedger(true);
    ledger.accept(request('a'));
    await ledger.onToolBoundary();
    expect(events).toEqual([]);
    expect(await ledger.onEcho('other')).toBe(false);
    expect(await ledger.onEcho('a')).toBe(true);
    expect(events).toEqual(['row:a', 'delivered:a']);
  });

  test('returns an entry with no echo to the queue when the turn ends, with no row', async () => {
    const { ledger, events } = makeLedger(true);
    ledger.accept(request('a'));
    await ledger.onTurnEnd();
    expect(events).toEqual(['revert:a']);
    expect(ledger.hasPending()).toBe(false);
  });
});

describe('SoftInjectionLedger without a delivery acknowledgement', () => {
  test('records the row at the next tool boundary and leaves the entry sent', async () => {
    const { ledger, events } = makeLedger(false);
    ledger.accept(request('a'));
    await ledger.onToolBoundary();
    expect(events).toEqual(['row:a']);
  });

  test('carries an unread entry across the turn end and resolves it when the next turn starts', async () => {
    const { ledger, events } = makeLedger(false);
    ledger.accept(request('a'));
    await ledger.onTurnEnd();
    expect(events).toEqual([]);
    await ledger.onTurnStart();
    expect(events).toEqual(['row:a']);
  });

  test('returns an entry no turn carried when the node ends', async () => {
    const { ledger, events } = makeLedger(false);
    ledger.accept(request('a'));
    await ledger.onTurnEnd();
    await ledger.onNodeEnd();
    expect(events).toEqual(['revert:a']);
  });
});
