import { describe, expect, test } from 'bun:test';
import { HttpError } from '@/lib/settings/http';
import {
  PLAINTEXT_NOTICE,
  LOOP_GROUP_BODY_NOTE,
  buildPatchesFromDrafts,
  draftFromPatch,
  draftsFromPatches,
  emptyNodeDraft,
  formatWorkflowEnvActionError,
  isValidEnvName,
  thinkingFromPatch,
  thinkingToPatch,
  type NodePatchDraft,
} from './editor';
import type { WorkflowEnvPreviewTarget } from './api';

const targets: WorkflowEnvPreviewTarget[] = [
  {
    id: 'plan',
    nodeType: 'prompt',
    allowedFields: ['provider', 'model', 'effort', 'thinking', 'prompt'],
  },
  {
    id: 'include__child',
    nodeType: 'command',
    allowedFields: ['provider', 'model', 'effort', 'thinking'],
  },
  {
    id: 'run_bash',
    nodeType: 'bash',
    allowedFields: ['bash'],
  },
  {
    id: 'group',
    nodeType: 'loop_group',
    allowedFields: ['provider', 'model'],
  },
];

function draft(partial: Partial<NodePatchDraft> & { nodeId: string }): NodePatchDraft {
  return { ...emptyNodeDraft(partial.nodeId), ...partial };
}

describe('workflow-env-editor thinking', () => {
  test('normalizes schema-supported thinking choices', () => {
    expect(thinkingToPatch({ mode: 'unset', budgetTokens: '' })).toBeUndefined();
    expect(thinkingToPatch({ mode: 'adaptive', budgetTokens: '' })).toEqual({ type: 'adaptive' });
    expect(thinkingToPatch({ mode: 'disabled', budgetTokens: '' })).toEqual({ type: 'disabled' });
    // Blank budget omits optional budgetTokens (thinkingConfigSchema .optional()).
    expect(thinkingToPatch({ mode: 'enabled', budgetTokens: '' })).toEqual({ type: 'enabled' });
    expect(thinkingToPatch({ mode: 'enabled', budgetTokens: '   ' })).toEqual({ type: 'enabled' });
    // Positive integer serializes unchanged.
    expect(thinkingToPatch({ mode: 'enabled', budgetTokens: '2000' })).toEqual({
      type: 'enabled',
      budgetTokens: 2000,
    });
    expect(thinkingToPatch({ mode: 'enabled', budgetTokens: '1' })).toEqual({
      type: 'enabled',
      budgetTokens: 1,
    });
  });

  test('rejects invalid budgetTokens including zero and non-finite', () => {
    const positiveMsg = /positive integer/;
    // thinkingConfigSchema: z.number().int().positive() — 0 and -0 are not positive.
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: '0' })).toThrow(positiveMsg);
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: '-0' })).toThrow(positiveMsg);
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: '0.0' })).toThrow(positiveMsg);
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: '-1' })).toThrow(positiveMsg);
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: '1.5' })).toThrow(positiveMsg);
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: 'NaN' })).toThrow(positiveMsg);
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: 'Infinity' })).toThrow(
      positiveMsg
    );
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: '-Infinity' })).toThrow(
      positiveMsg
    );
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: 'abc' })).toThrow(positiveMsg);
  });

  test('buildPatchesFromDrafts surfaces zero-budget thinking as local error', () => {
    const zero = buildPatchesFromDrafts(
      [
        draft({
          nodeId: 'plan',
          thinking: { mode: 'enabled', budgetTokens: '0' },
          model: 'sonnet',
        }),
      ],
      targets
    );
    expect(zero).toEqual({
      ok: false,
      error: 'thinking budgetTokens must be a positive integer',
    });

    const blank = buildPatchesFromDrafts(
      [
        draft({
          nodeId: 'plan',
          thinking: { mode: 'enabled', budgetTokens: '' },
        }),
      ],
      targets
    );
    expect(blank).toEqual({
      ok: true,
      patches: { plan: { thinking: { type: 'enabled' } } },
    });

    const positive = buildPatchesFromDrafts(
      [
        draft({
          nodeId: 'plan',
          thinking: { mode: 'enabled', budgetTokens: '4096' },
        }),
      ],
      targets
    );
    expect(positive).toEqual({
      ok: true,
      patches: { plan: { thinking: { type: 'enabled', budgetTokens: 4096 } } },
    });
  });

  test('round-trips thinking from stored patch', () => {
    expect(thinkingFromPatch({ type: 'adaptive' })).toEqual({
      mode: 'adaptive',
      budgetTokens: '',
    });
    expect(thinkingFromPatch({ type: 'enabled', budgetTokens: 9 })).toEqual({
      mode: 'enabled',
      budgetTokens: '9',
    });
    expect(thinkingFromPatch(undefined).mode).toBe('unset');
  });
});

describe('buildPatchesFromDrafts — full-map replacement', () => {
  test('builds complete patch map with only allowed fields', () => {
    const result = buildPatchesFromDrafts(
      [
        draft({
          nodeId: 'plan',
          provider: 'claude',
          model: 'sonnet',
          effort: 'high',
          thinking: { mode: 'enabled', budgetTokens: '1000' },
          promptEnabled: true,
          prompt: 'do the thing',
          bashEnabled: false,
          bash: 'should-not-appear',
        }),
        draft({
          nodeId: 'include__child',
          provider: 'codex',
          model: 'gpt',
        }),
        draft({
          nodeId: 'run_bash',
          bashEnabled: true,
          bash: 'echo hi',
        }),
      ],
      targets
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Full map — every chosen node present; bash stripped from prompt target.
    expect(result.patches).toEqual({
      plan: {
        provider: 'claude',
        model: 'sonnet',
        effort: 'high',
        thinking: { type: 'enabled', budgetTokens: 1000 },
        prompt: 'do the thing',
      },
      include__child: {
        provider: 'codex',
        model: 'gpt',
      },
      run_bash: {
        bash: 'echo hi',
      },
    });
    expect(result.patches.plan).not.toHaveProperty('bash');
  });

  test('requires non-empty patch per chosen node', () => {
    const empty = buildPatchesFromDrafts([draft({ nodeId: 'plan' })], targets);
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error).toMatch(/at least one allowed field/i);
  });

  test('zero drafts round-trip to empty no-op patches map', () => {
    const result = buildPatchesFromDrafts([], targets);
    expect(result).toEqual({ ok: true, patches: {} });
  });

  test('preserves explicit empty and whitespace prompt/bash; omits untouched bodies', () => {
    const emptyPrompt = buildPatchesFromDrafts(
      [draft({ nodeId: 'plan', promptEnabled: true, prompt: '' })],
      targets
    );
    expect(emptyPrompt.ok).toBe(true);
    if (!emptyPrompt.ok) return;
    expect(emptyPrompt.patches).toEqual({ plan: { prompt: '' } });
    expect(Object.prototype.hasOwnProperty.call(emptyPrompt.patches.plan, 'prompt')).toBe(true);

    const emptyBash = buildPatchesFromDrafts(
      [draft({ nodeId: 'run_bash', bashEnabled: true, bash: '' })],
      targets
    );
    expect(emptyBash.ok).toBe(true);
    if (!emptyBash.ok) return;
    expect(emptyBash.patches).toEqual({ run_bash: { bash: '' } });

    const whitespace = buildPatchesFromDrafts(
      [
        draft({ nodeId: 'plan', promptEnabled: true, prompt: '  \n\t' }),
        draft({ nodeId: 'run_bash', bashEnabled: true, bash: ' \t ' }),
      ],
      targets
    );
    expect(whitespace.ok).toBe(true);
    if (!whitespace.ok) return;
    expect(whitespace.patches.plan?.prompt).toBe('  \n\t');
    expect(whitespace.patches.run_bash?.bash).toBe(' \t ');

    // Disabled/untouched body controls stay omitted even when the draft string is ''.
    const absentBodies = buildPatchesFromDrafts(
      [draft({ nodeId: 'plan', provider: 'claude', promptEnabled: false, prompt: '' })],
      targets
    );
    expect(absentBodies.ok).toBe(true);
    if (!absentBodies.ok) return;
    expect(absentBodies.patches).toEqual({ plan: { provider: 'claude' } });
    expect(absentBodies.patches.plan).not.toHaveProperty('prompt');
    expect(absentBodies.patches.plan).not.toHaveProperty('bash');
  });

  test('draftFromPatch restores body presence vs omission', () => {
    const withEmpty = draftFromPatch('plan', { prompt: '' });
    expect(withEmpty.promptEnabled).toBe(true);
    expect(withEmpty.prompt).toBe('');

    const withWhitespace = draftFromPatch('run_bash', { bash: ' \n' });
    expect(withWhitespace.bashEnabled).toBe(true);
    expect(withWhitespace.bash).toBe(' \n');

    const omitted = draftFromPatch('plan', { model: 'sonnet' });
    expect(omitted.promptEnabled).toBe(false);
    expect(omitted.bashEnabled).toBe(false);
    expect(omitted.prompt).toBe('');
    expect(omitted.bash).toBe('');

    // Round-trip: empty body draft → patches → drafts keeps presence.
    const built = buildPatchesFromDrafts(
      [draft({ nodeId: 'plan', promptEnabled: true, prompt: '' })],
      targets
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const reloaded = draftsFromPatches(built.patches);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.promptEnabled).toBe(true);
    expect(reloaded[0]?.prompt).toBe('');
  });

  test('rejects unknown and duplicate targets', () => {
    const unknown = buildPatchesFromDrafts(
      [draft({ nodeId: 'group.child', provider: 'claude' })],
      targets
    );
    expect(unknown.ok).toBe(false);

    const dup = buildPatchesFromDrafts(
      [draft({ nodeId: 'plan', provider: 'a' }), draft({ nodeId: 'plan', provider: 'b' })],
      targets
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/Duplicate/);
  });

  test('preserves include-expanded ids as returned', () => {
    const result = buildPatchesFromDrafts(
      [draft({ nodeId: 'include__child', model: 'x' })],
      targets
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.patches)).toEqual(['include__child']);
  });

  test('draftsFromPatches loads complete map for editor', () => {
    const drafts = draftsFromPatches({
      plan: { provider: 'claude', thinking: { type: 'disabled' } },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.nodeId).toBe('plan');
    expect(drafts[0]?.provider).toBe('claude');
    expect(drafts[0]?.thinking.mode).toBe('disabled');
    expect(draftFromPatch('x', { model: 'm' }).model).toBe('m');
  });
});

describe('ENV name + notices', () => {
  test('validates ENV name shape', () => {
    expect(isValidEnvName('fast')).toBe(true);
    expect(isValidEnvName('A1._-z')).toBe(true);
    expect(isValidEnvName('')).toBe(false);
    expect(isValidEnvName('-bad')).toBe(false);
    expect(isValidEnvName('has space')).toBe(false);
  });

  test('plaintext notice never claims secrets or encryption', () => {
    expect(PLAINTEXT_NOTICE.toLowerCase()).toContain('plaintext');
    expect(PLAINTEXT_NOTICE.toLowerCase()).toContain('not secrets');
    expect(PLAINTEXT_NOTICE.toLowerCase()).toContain('not encrypted');
    expect(PLAINTEXT_NOTICE.toLowerCase()).not.toMatch(/\bsecret\b(?!s)/); // allow "secrets" in "not secrets"
    expect(LOOP_GROUP_BODY_NOTE.toLowerCase()).toContain('loop-group');
  });
});

describe('conflict messages', () => {
  test('formats 409 conflict from HttpError body', () => {
    const err = new HttpError(
      409,
      '/api/workflows/wf/envs',
      JSON.stringify({ error: 'env_name_conflict', detail: 'name taken' })
    );
    expect(formatWorkflowEnvActionError(err)).toBe('name taken');
    const bare = new HttpError(409, '/x', 'not-json');
    expect(formatWorkflowEnvActionError(bare)).toMatch(/conflict/i);
  });
});
