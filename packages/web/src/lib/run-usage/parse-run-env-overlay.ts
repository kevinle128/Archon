/**
 * Defensive parser for the run's `metadata.envOverlay`. It accepts only the strict
 * pending or complete shapes the engine writes, and never surfaces prompt or bash
 * patch bodies. A malformed overlay yields null so the rest of the run stays usable.
 */
import type {
  RunEnvOverlay,
  RunEnvResolvedRow,
} from '@/components/workflow-envs/WorkflowEnvResolvedTable';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Require a real string[] (fail closed on non-array); keep only non-empty strings. */
function readRequiredStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return null;
    if (item.length > 0) out.push(item);
  }
  return out;
}

const PENDING_ENV_OVERLAY_KEYS: Record<string, true> = {
  envId: true,
  envName: true,
  workflowName: true,
  patches: true,
  skippedNodeIds: true,
};

const COMPLETE_ENV_OVERLAY_KEYS: Record<string, true> = {
  ...PENDING_ENV_OVERLAY_KEYS,
  latestMissingNodeIds: true,
  resolved: true,
};

const RESOLVED_ROW_KEYS: Record<string, true> = {
  provider: true,
  model: true,
  tier: true,
  modelReasoningEffort: true,
  effort: true,
  thinking: true,
};

const THINKING_TYPE_ONLY_KEYS: Record<string, true> = { type: true };
const THINKING_ENABLED_KEYS: Record<string, true> = { type: true, budgetTokens: true };

function hasOnlyAllowedKeys(rec: Record<string, unknown>, allowed: Record<string, true>): boolean {
  for (const key of Object.keys(rec)) {
    if (!allowed[key]) return false;
  }
  return true;
}

/** Mirror engine ENV overlay patch bounds (no @archon/workflows import). */
const ENV_OVERLAY_MAX_TARGETS = 256;
const ENV_OVERLAY_MAX_BYTES = 1024 * 1024;

const ENV_OVERLAY_PATCH_FIELDS: Record<string, true> = {
  provider: true,
  model: true,
  effort: true,
  thinking: true,
  prompt: true,
  bash: true,
};

const ENV_PATCH_TARGET_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Fail-closed local mirror of envNodePatchSchema / envPatchesSchema.
 * Validates shape only — never returns or copies patch bodies.
 */
function isValidEnvPatchesDocument(patches: object): boolean {
  const rec = patches as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.length > ENV_OVERLAY_MAX_TARGETS) return false;

  // Same bound the engine/store enforce: UTF-8 byte length of JSON.stringify(patches).
  const bytes = new TextEncoder().encode(JSON.stringify(patches)).byteLength;
  if (bytes > ENV_OVERLAY_MAX_BYTES) return false;

  for (const key of keys) {
    if (
      key.length === 0 ||
      !ENV_PATCH_TARGET_KEY_RE.test(key) ||
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor'
    ) {
      return false;
    }
    if (!isValidEnvNodePatch(rec[key])) return false;
  }
  return true;
}

function isValidEnvNodePatch(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(rec, ENV_OVERLAY_PATCH_FIELDS)) return false;

  let hasField = false;

  if (Object.prototype.hasOwnProperty.call(rec, 'provider')) {
    hasField = true;
    const v = rec.provider;
    // provider: trimmed non-empty string (ENV cannot unset).
    if (typeof v !== 'string' || v.trim().length === 0) return false;
  }

  if (Object.prototype.hasOwnProperty.call(rec, 'model')) {
    hasField = true;
    const v = rec.model;
    if (typeof v !== 'string' || v.trim().length === 0) return false;
  }

  if (Object.prototype.hasOwnProperty.call(rec, 'effort')) {
    hasField = true;
    // effortLevelSchema: non-empty string (no trim).
    if (typeof rec.effort !== 'string' || rec.effort.length === 0) return false;
  }

  if (Object.prototype.hasOwnProperty.call(rec, 'thinking')) {
    hasField = true;
    // Same adaptive|enabled|disabled contract as resolved-row thinking, including
    // positive integer budgetTokens (zero budget fails closed).
    if (readThinking(rec.thinking) === null) return false;
  }

  if (Object.prototype.hasOwnProperty.call(rec, 'prompt')) {
    hasField = true;
    // Arbitrary string preserved byte-for-byte (empty/whitespace OK).
    if (typeof rec.prompt !== 'string') return false;
  }

  if (Object.prototype.hasOwnProperty.call(rec, 'bash')) {
    hasField = true;
    if (typeof rec.bash !== 'string') return false;
  }

  // Empty per-node patch is invalid; empty document map is valid (caller).
  return hasField;
}

/**
 * Present optional non-empty string field.
 * Absent → undefined; present-and-valid → string; present-but-invalid → null (fail closed).
 */
function readPresentOptionalString(
  rec: Record<string, unknown>,
  key: string
): string | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(rec, key)) return undefined;
  const v = rec[key];
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

/**
 * Thinking must match supported adaptive/enabled/disabled shapes when present.
 * Returns null for malformed or unsupported values (fail closed — never drop silently).
 */
function readThinking(v: unknown): RunEnvResolvedRow['thinking'] | null {
  if (typeof v === 'string') {
    if (v === 'adaptive' || v === 'enabled' || v === 'disabled') {
      return { type: v };
    }
    return null;
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  const type = rec.type;
  if (type === 'adaptive' || type === 'disabled') {
    if (!hasOnlyAllowedKeys(rec, THINKING_TYPE_ONLY_KEYS)) return null;
    return { type };
  }
  if (type === 'enabled') {
    if (!hasOnlyAllowedKeys(rec, THINKING_ENABLED_KEYS)) return null;
    const thinking: { type: string; budgetTokens?: number } = { type: 'enabled' };
    if (Object.prototype.hasOwnProperty.call(rec, 'budgetTokens')) {
      const budget = rec.budgetTokens;
      // Mirror thinkingConfigSchema: optional positive integer.
      if (typeof budget !== 'number' || !Number.isInteger(budget) || budget <= 0) {
        return null;
      }
      thinking.budgetTokens = budget;
    }
    return thinking;
  }
  return null;
}

function readResolvedRow(nodeId: string, value: unknown): RunEnvResolvedRow | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(rec, RESOLVED_ROW_KEYS)) return null;
  if (!isNonEmptyString(rec.provider)) return null;

  const row: RunEnvResolvedRow = { nodeId, provider: rec.provider };

  const model = readPresentOptionalString(rec, 'model');
  if (model === null) return null;
  if (model !== undefined) row.model = model;

  if (Object.prototype.hasOwnProperty.call(rec, 'tier')) {
    const tier = rec.tier;
    if (tier !== 'small' && tier !== 'medium' && tier !== 'large') return null;
    row.tier = tier;
  }

  const modelReasoningEffort = readPresentOptionalString(rec, 'modelReasoningEffort');
  if (modelReasoningEffort === null) return null;
  if (modelReasoningEffort !== undefined) row.modelReasoningEffort = modelReasoningEffort;

  const effort = readPresentOptionalString(rec, 'effort');
  if (effort === null) return null;
  if (effort !== undefined) row.effort = effort;

  if (Object.prototype.hasOwnProperty.call(rec, 'thinking')) {
    const thinking = readThinking(rec.thinking);
    if (thinking === null) return null;
    row.thinking = thinking;
  }

  return row;
}

/**
 * Parse `metadata.envOverlay` without importing `@archon/workflows`.
 * Accepts only strict pending (`AppliedEnvOverlay`) or complete
 * (`EnvOverlaySnapshot`) shapes — never legacy/malformed hybrids.
 * Malformed → null (omit overlay UI; keep the rest of the run usable).
 * Never surfaces prompt/bash patch bodies.
 */
export function parseRunEnvOverlay(
  meta: Record<string, unknown> | undefined
): RunEnvOverlay | null {
  if (meta === undefined) return null;
  const raw = meta.envOverlay;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(rec.envId) ||
    !isNonEmptyString(rec.envName) ||
    !isNonEmptyString(rec.workflowName)
  ) {
    return null;
  }

  // patches are required on both lifecycle forms; never exposed on RunEnvOverlay.
  // Fail closed when the frozen document fails the engine overlay contract —
  // a non-array object alone is not enough (corrupt bodies must not look trusted).
  if (
    rec.patches === null ||
    rec.patches === undefined ||
    typeof rec.patches !== 'object' ||
    Array.isArray(rec.patches) ||
    !isValidEnvPatchesDocument(rec.patches)
  ) {
    return null;
  }

  const skippedNodeIds = readRequiredStringArray(rec.skippedNodeIds);
  if (skippedNodeIds === null) return null;

  const hasResolvedKey = Object.prototype.hasOwnProperty.call(rec, 'resolved');
  const hasLatestMissingKey = Object.prototype.hasOwnProperty.call(rec, 'latestMissingNodeIds');

  // Pending applied form: no resolved key, no latestMissingNodeIds key.
  if (!hasResolvedKey && !hasLatestMissingKey) {
    if (!hasOnlyAllowedKeys(rec, PENDING_ENV_OVERLAY_KEYS)) return null;
    return {
      envId: rec.envId,
      envName: rec.envName,
      workflowName: rec.workflowName,
      complete: false,
      skippedNodeIds,
      latestMissingNodeIds: [],
      resolved: null,
    };
  }

  // Complete snapshot requires both keys; hybrids (one without the other) fail closed.
  if (!hasResolvedKey || !hasLatestMissingKey) return null;
  if (!hasOnlyAllowedKeys(rec, COMPLETE_ENV_OVERLAY_KEYS)) return null;

  if (rec.resolved === null || typeof rec.resolved !== 'object' || Array.isArray(rec.resolved)) {
    return null;
  }

  const latestMissingNodeIds = readRequiredStringArray(rec.latestMissingNodeIds);
  if (latestMissingNodeIds === null) return null;

  const rows: RunEnvResolvedRow[] = [];
  for (const [nodeId, value] of Object.entries(rec.resolved as Record<string, unknown>)) {
    if (nodeId.length === 0) return null;
    const row = readResolvedRow(nodeId, value);
    // Any invalid resolved row fails the whole overlay — never manufacture complete:true
    // with a silently dropped subset (false "No provider-turn request rows" confidence).
    if (row === null) return null;
    rows.push(row);
  }
  rows.sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  return {
    envId: rec.envId,
    envName: rec.envName,
    workflowName: rec.workflowName,
    complete: true,
    skippedNodeIds,
    latestMissingNodeIds,
    resolved: rows,
  };
}
