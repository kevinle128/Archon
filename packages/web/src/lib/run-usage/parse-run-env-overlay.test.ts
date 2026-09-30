import { describe, expect, test } from 'bun:test';

import { parseRunEnvOverlay } from './parse-run-env-overlay';

const IDENTITY = { envId: 'e1', envName: 'fast', workflowName: 'plan' };

describe('parseRunEnvOverlay', () => {
  test('a pending overlay keeps identity and skipped nodes and never exposes patch bodies', () => {
    const overlay = parseRunEnvOverlay({
      envOverlay: {
        ...IDENTITY,
        patches: { plan: { model: 'haiku', prompt: 'SECRET_BODY' } },
        skippedNodeIds: ['missing'],
      },
    });
    expect(overlay).toEqual({
      ...IDENTITY,
      complete: false,
      skippedNodeIds: ['missing'],
      latestMissingNodeIds: [],
      resolved: null,
    });
    expect(JSON.stringify(overlay)).not.toContain('SECRET_BODY');
  });

  test('a complete snapshot sorts resolved rows by node id', () => {
    const overlay = parseRunEnvOverlay({
      envOverlay: {
        ...IDENTITY,
        patches: {},
        skippedNodeIds: ['gone'],
        latestMissingNodeIds: ['plan'],
        resolved: {
          zeta: { provider: 'claude', model: 'sonnet', effort: 'high' },
          alpha: {
            provider: 'codex',
            tier: 'large',
            thinking: { type: 'enabled', budgetTokens: 2048 },
          },
        },
      },
    });
    expect(overlay?.complete).toBe(true);
    expect(overlay?.latestMissingNodeIds).toEqual(['plan']);
    expect(overlay?.resolved?.map(row => row.nodeId)).toEqual(['alpha', 'zeta']);
  });

  test('absent, malformed and hybrid overlays return null', () => {
    expect(parseRunEnvOverlay(undefined)).toBeNull();
    expect(parseRunEnvOverlay({})).toBeNull();
    expect(parseRunEnvOverlay({ envOverlay: 'legacy' })).toBeNull();
    expect(parseRunEnvOverlay({ envOverlay: { envName: 'only-name' } })).toBeNull();
    // Missing patches.
    expect(parseRunEnvOverlay({ envOverlay: { ...IDENTITY, skippedNodeIds: [] } })).toBeNull();
    // Resolved without latestMissingNodeIds.
    expect(
      parseRunEnvOverlay({
        envOverlay: { ...IDENTITY, patches: {}, skippedNodeIds: [], resolved: {} },
      })
    ).toBeNull();
    // One invalid resolved row fails the whole overlay.
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...IDENTITY,
          patches: {},
          skippedNodeIds: [],
          latestMissingNodeIds: [],
          resolved: { a: { provider: 'claude' }, b: { model: 'no-provider' } },
        },
      })
    ).toBeNull();
  });
});
