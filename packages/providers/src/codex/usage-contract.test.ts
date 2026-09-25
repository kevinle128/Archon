import { describe, expect, test } from 'bun:test';
import type { TurnCompletedEvent } from '@openai/codex-sdk';

import { extractUsageFromCodexEvent } from './provider';

/**
 * Contract test: anchors the Codex usage parser to the SDK's OWN type.
 *
 * Codex reports usage through `@openai/codex-sdk`'s `TurnCompletedEvent`, in
 * memory (nothing lands on disk to record), so the anchor is the type itself:
 * the fixture below is declared `satisfies TurnCompletedEvent`. If the SDK
 * renames a usage field (e.g. `input_tokens`), removes one, or reshapes the
 * event, this stops compiling — exactly the drift a hand-written, untyped
 * fixture would sail past. The runtime asserts then prove the parser maps that
 * SDK shape onto the ledger entry (Codex reports NO cost → tokens only).
 */

// Realistic values from an actual Codex turn (gpt-6-sol); shape enforced by the SDK type.
const realTurnCompleted = {
  type: 'turn.completed',
  usage: {
    input_tokens: 20807,
    cached_input_tokens: 512,
    output_tokens: 40,
    reasoning_output_tokens: 12,
  },
} satisfies TurnCompletedEvent;

describe('Codex usage contract (SDK TurnCompletedEvent shape)', () => {
  test('parser maps a TurnCompletedEvent onto the expected ModelUsageEntry', () => {
    const { usageBreakdown } = extractUsageFromCodexEvent(realTurnCompleted, 'gpt-6-sol');
    expect(usageBreakdown).toBeDefined();
    const entry = usageBreakdown?.[0];
    if (!entry) throw new Error('parser produced no usage breakdown for a real turn');

    expect(entry.provider).toBe('openai');
    expect(entry.model).toBe('gpt-6-sol');
    expect(entry.modelSource).toBe('requested');

    // Non-cached input = input_tokens - cached_input_tokens; cache read is broken out.
    expect(entry.inputTokens).toBe(20807 - 512);
    expect(entry.cacheReadTokens).toBe(512);
    expect(entry.outputTokens).toBe(40);
    expect(entry.reasoningTokens).toBe(12);

    // Codex reports no USD → the entry carries no cost (estimate fills it downstream).
    expect(entry.costUsd).toBeUndefined();
  });
});
