/**
 * Pure helpers for the Workflow ENV management dialog.
 * Keeps patch building, thinking normalization, and conflict messaging out of
 * React so component tests stay deterministic.
 */
import { HttpError } from '@/lib/settings/http';
import type { WorkflowEnv, WorkflowEnvPreviewTarget } from './api';

export type AllowedField = WorkflowEnvPreviewTarget['allowedFields'][number];
export type EnvNodePatch = WorkflowEnv['patches'][string];
export type EnvPatches = WorkflowEnv['patches'];

export type ThinkingMode = 'unset' | 'adaptive' | 'enabled' | 'disabled';

export interface ThinkingEditorValue {
  mode: ThinkingMode;
  /** Only when mode === 'enabled'; empty string omits budgetTokens. */
  budgetTokens: string;
}

export interface NodePatchDraft {
  nodeId: string;
  provider: string;
  model: string;
  effort: string;
  thinking: ThinkingEditorValue;
  /**
   * Body fields distinguish omission from presence-with-empty-string.
   * `*Enabled: false` → field omitted from the patch map.
   * `*Enabled: true` → field included byte-for-byte (including `''` and whitespace).
   */
  promptEnabled: boolean;
  prompt: string;
  bashEnabled: boolean;
  bash: string;
}

/** Plaintext storage notice — never describe prompt/bash as secrets/encrypted. */
export const PLAINTEXT_NOTICE =
  'Prompt and bash bodies are stored in plaintext and visible to anyone who can access this install. They are not secrets and are not encrypted.';

/** loop_group body nodes are never targets; server baseline already excludes them. */
export const LOOP_GROUP_BODY_NOTE =
  'Nested loop-group body nodes cannot be targeted. Only expanded top-level node ids returned by the server are editable.';

export const EMPTY_THINKING: ThinkingEditorValue = { mode: 'unset', budgetTokens: '' };

const ENV_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function emptyNodeDraft(nodeId = ''): NodePatchDraft {
  return {
    nodeId,
    provider: '',
    model: '',
    effort: '',
    thinking: { mode: 'unset', budgetTokens: '' },
    promptEnabled: false,
    prompt: '',
    bashEnabled: false,
    bash: '',
  };
}

export function isValidEnvName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 64 && ENV_NAME_RE.test(trimmed);
}

export function thinkingFromPatch(
  thinking: EnvNodePatch['thinking'] | undefined
): ThinkingEditorValue {
  if (thinking === undefined) return { mode: 'unset', budgetTokens: '' };
  if (thinking.type === 'adaptive') return { mode: 'adaptive', budgetTokens: '' };
  if (thinking.type === 'disabled') return { mode: 'disabled', budgetTokens: '' };
  return {
    mode: 'enabled',
    budgetTokens: thinking.budgetTokens !== undefined ? String(thinking.budgetTokens) : '',
  };
}

/**
 * Schema-supported thinking choices only: adaptive | enabled(+optional budget) | disabled.
 * budgetTokens matches thinkingConfigSchema: z.number().int().positive().optional() —
 * blank omits the field; a present value must be a positive integer (0 / -0 / negative /
 * fractional / non-finite rejected).
 */
export function thinkingToPatch(value: ThinkingEditorValue): EnvNodePatch['thinking'] | undefined {
  if (value.mode === 'unset') return undefined;
  if (value.mode === 'adaptive') return { type: 'adaptive' };
  if (value.mode === 'disabled') return { type: 'disabled' };
  const trimmed = value.budgetTokens.trim();
  if (trimmed.length === 0) return { type: 'enabled' };
  const n = Number(trimmed);
  // Same rule as thinkingConfigSchema enabled.budgetTokens: int + positive (not ≥0).
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('thinking budgetTokens must be a positive integer');
  }
  return { type: 'enabled', budgetTokens: n };
}

export function draftFromPatch(nodeId: string, patch: EnvNodePatch): NodePatchDraft {
  return {
    nodeId,
    provider: patch.provider ?? '',
    model: patch.model ?? '',
    effort: patch.effort ?? '',
    thinking: thinkingFromPatch(patch.thinking),
    // Presence of the key (even with '') is distinct from omission.
    promptEnabled: patch.prompt !== undefined,
    prompt: patch.prompt ?? '',
    bashEnabled: patch.bash !== undefined,
    bash: patch.bash ?? '',
  };
}

export function draftsFromPatches(patches: EnvPatches): NodePatchDraft[] {
  return Object.entries(patches).map(([nodeId, patch]) => draftFromPatch(nodeId, patch));
}

export function targetsByIdMap(
  targets: WorkflowEnvPreviewTarget[]
): Map<string, WorkflowEnvPreviewTarget> {
  return new Map(targets.map(t => [t.id, t]));
}

export function allowedFieldsForNode(
  nodeId: string,
  targets: WorkflowEnvPreviewTarget[]
): AllowedField[] {
  return targets.find(t => t.id === nodeId)?.allowedFields ?? [];
}

/**
 * Build the complete patch map for create/PATCH (full document, not a deep delta).
 * Zero drafts → valid no-op ENV `{}`.
 * Requires a non-empty patch object per chosen node when any draft row exists.
 * Explicitly enabled empty/whitespace prompt/bash bodies are preserved byte-for-byte;
 * untouched (disabled) body controls remain omitted.
 */
export function buildPatchesFromDrafts(
  drafts: NodePatchDraft[],
  targets: WorkflowEnvPreviewTarget[]
): { ok: true; patches: EnvPatches } | { ok: false; error: string } {
  // Empty patch map is a valid no-op ENV (schema + store allow `{}`).
  if (drafts.length === 0) {
    return { ok: true, patches: {} };
  }
  const byId = targetsByIdMap(targets);
  const patches: EnvPatches = {};
  const seen = new Set<string>();

  for (const draft of drafts) {
    const id = draft.nodeId.trim();
    if (id.length === 0) {
      return { ok: false, error: 'Every row needs a target node.' };
    }
    if (seen.has(id)) {
      return { ok: false, error: `Duplicate target node: ${id}` };
    }
    seen.add(id);

    const target = byId.get(id);
    if (target === undefined) {
      return { ok: false, error: `Unknown target node: ${id}` };
    }
    const allowed = new Set<AllowedField>(target.allowedFields);
    const patch: EnvNodePatch = {};

    if (allowed.has('provider') && draft.provider.trim().length > 0) {
      patch.provider = draft.provider.trim();
    }
    if (allowed.has('model') && draft.model.trim().length > 0) {
      patch.model = draft.model.trim();
    }
    if (allowed.has('effort') && draft.effort.trim().length > 0) {
      patch.effort = draft.effort.trim();
    }
    // prompt/bash: enabled means include byte-for-byte ('' and whitespace are valid).
    if (allowed.has('prompt') && draft.promptEnabled) {
      patch.prompt = draft.prompt;
    }
    if (allowed.has('bash') && draft.bashEnabled) {
      patch.bash = draft.bash;
    }
    if (allowed.has('thinking') && draft.thinking.mode !== 'unset') {
      try {
        const thinking = thinkingToPatch(draft.thinking);
        if (thinking !== undefined) patch.thinking = thinking;
      } catch (err: unknown) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Invalid thinking value',
        };
      }
    }

    if (Object.keys(patch).length === 0) {
      return {
        ok: false,
        error: `Node "${id}" needs at least one allowed field set.`,
      };
    }
    patches[id] = patch;
  }

  return { ok: true, patches };
}

/**
 * Surface 409 name conflicts and server `{ error, detail? }` bodies without leaking
 * prompt/bash patch content (server never echoes those in errors).
 */
export function formatWorkflowEnvActionError(err: unknown): string {
  if (err instanceof HttpError) {
    let parsed: { error?: unknown; detail?: unknown } | null = null;
    try {
      parsed = JSON.parse(err.bodySnippet) as { error?: unknown; detail?: unknown };
    } catch {
      parsed = null;
    }
    const detail = typeof parsed?.detail === 'string' ? parsed.detail : null;
    const code = typeof parsed?.error === 'string' ? parsed.error : null;

    if (err.status === 409) {
      return detail ?? 'ENV name already exists for this workflow (conflict).';
    }
    if (detail !== null && detail.length > 0) return detail;
    if (code !== null && code.length > 0) return code;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Request failed.';
}
