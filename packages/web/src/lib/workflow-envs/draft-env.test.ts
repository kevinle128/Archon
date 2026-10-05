import { describe, test, expect } from 'bun:test';
import { NONE_ENV_SELECTION, isStartBlockedBySelectedEnv, envStartBlockReason } from './draft-env';
import type { WorkflowEnvPreview } from './api';

const okPreview: WorkflowEnvPreview = {
  preview: true,
  authoritative: false,
  workflowName: 'feature',
  envId: 'e1',
  envName: 'fast',
  skippedNodeIds: [],
  targets: [],
  resolved: [
    {
      nodeId: 'plan',
      provider: 'claude',
      model: 'sonnet',
    },
  ],
};

describe('draft-env Start gating', () => {
  test('None/YAML never blocks on missing or failed preview', () => {
    expect(
      isStartBlockedBySelectedEnv({
        selectedEnvId: NONE_ENV_SELECTION,
        preview: undefined,
        previewError: undefined,
      })
    ).toBe(false);
    expect(
      isStartBlockedBySelectedEnv({
        selectedEnvId: null,
        preview: undefined,
        previewError: new Error('boom'),
      })
    ).toBe(false);
    expect(
      envStartBlockReason({
        selectedEnvId: null,
        preview: undefined,
        previewError: new Error('boom'),
      })
    ).toBeNull();
  });

  test('selected ENV blocks while preview is loading (undefined, no error)', () => {
    expect(
      isStartBlockedBySelectedEnv({
        selectedEnvId: 'e1',
        preview: undefined,
        previewError: undefined,
      })
    ).toBe(true);
    expect(
      envStartBlockReason({
        selectedEnvId: 'e1',
        preview: undefined,
        previewError: undefined,
      })
    ).toMatch(/Loading/);
  });

  test('selected ENV blocks on preview error and never implies YAML reset', () => {
    const err = new Error('preview failed');
    expect(
      isStartBlockedBySelectedEnv({
        selectedEnvId: 'e1',
        preview: undefined,
        previewError: err,
      })
    ).toBe(true);
    // Selection stays e1 — gating does not return a "reset to null" signal.
    expect(
      envStartBlockReason({
        selectedEnvId: 'e1',
        preview: undefined,
        previewError: err,
      })
    ).toMatch(/failed/);
  });

  test('selected ENV with successful preview allows Start', () => {
    expect(
      isStartBlockedBySelectedEnv({
        selectedEnvId: 'e1',
        preview: okPreview,
        previewError: undefined,
      })
    ).toBe(false);
    expect(
      envStartBlockReason({
        selectedEnvId: 'e1',
        preview: okPreview,
        previewError: undefined,
      })
    ).toBeNull();
  });
});
