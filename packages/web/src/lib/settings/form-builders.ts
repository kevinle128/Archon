import type {
  AliasRowForm,
  AssistantConfigForm,
  SafeConfigTiers,
  SettingsScope,
  TierEntry,
  TierName,
  TierRowForm,
  TiersForm,
  UpdateAliasesBody,
  UpdateAssistantConfigBody,
  UpdateTiersBody,
  UserAiPrefs,
} from './types';

/**
 * Pure form → PATCH-body transform. Omits a provider's `model` when blank (so we
 * never overwrite a saved model with `''`) and drops a provider entirely when it
 * contributes no fields. Codex additionally carries `modelReasoningEffort` /
 * `webSearchMode` when set.
 *
 * Safety note: the PATCH route validates only provider *ids* and merges the body
 * into config.yaml UNFILTERED — per-field safe-filtering runs on the read path, not
 * the write path. So it matters that this function only ever attaches the codex-only
 * fields to the `codex` entry (it does); it must not leak them onto other providers.
 */
export function buildAssistantUpdate(form: AssistantConfigForm): UpdateAssistantConfigBody {
  const assistants: Record<string, Record<string, unknown>> = {};
  for (const [providerId, rawModel] of Object.entries(form.models)) {
    const entry: Record<string, unknown> = {};
    const model = rawModel.trim();
    if (model !== '') entry.model = model;
    if (providerId === 'codex') {
      if (form.modelReasoningEffort !== '') entry.modelReasoningEffort = form.modelReasoningEffort;
      if (form.webSearchMode !== '') entry.webSearchMode = form.webSearchMode;
    }
    if (Object.keys(entry).length > 0) assistants[providerId] = entry;
  }

  const body: UpdateAssistantConfigBody = { assistant: form.assistant };
  if (Object.keys(assistants).length > 0) body.assistants = assistants;
  return body;
}

export const TIER_ORDER: readonly TierName[] = ['small', 'medium', 'large'];

/**
 * Pure form → PATCH body. A row whose provider OR model is blank is sent as
 * `null` (unset → built-in default); a fully-set row carries `effort` when
 * present. The editor always sends all three tiers, so the per-key-merge route
 * cleanly applies sets and unsets in one call.
 */
export function buildTiersUpdate(form: TiersForm): UpdateTiersBody {
  const tiers: UpdateTiersBody['tiers'] = {};
  for (const tier of TIER_ORDER) {
    const row = form[tier];
    const provider = row.provider.trim();
    const model = row.model.trim();
    if (provider && model) {
      const entry: TierEntry = { provider, model };
      if (row.effort.length > 0) entry.effort = row.effort;
      tiers[tier] = entry;
    } else {
      tiers[tier] = null;
    }
  }
  return { tiers };
}

/** Seed editable alias rows from a saved alias map (sorted by name). */
export function seedAliasRows(map: Record<string, TierEntry> | undefined): AliasRowForm[] {
  return Object.entries(map ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, e]) => ({ name, provider: e.provider, model: e.model, effort: e.effort ?? '' }));
}

/**
 * Pure form → PATCH body. Baseline names that no longer appear in the rows are
 * sent as `null` (unset — covers both deletion and rename), complete rows are
 * sent as entries, and incomplete rows (blank name/provider/model) are dropped.
 */
export function buildAliasesUpdate(
  rows: AliasRowForm[],
  baselineNames: readonly string[]
): UpdateAliasesBody {
  const aliases: UpdateAliasesBody['aliases'] = {};
  const present = new Set(rows.map(r => r.name.trim()).filter(n => n !== ''));
  for (const name of baselineNames) {
    if (!present.has(name)) aliases[name] = null;
  }
  for (const row of rows) {
    const name = row.name.trim();
    const provider = row.provider.trim();
    const model = row.model.trim();
    if (!name || !provider || !model) continue;
    const entry: TierEntry = { provider, model };
    if (row.effort.length > 0) entry.effort = row.effort;
    aliases[name] = entry;
  }
  return { aliases };
}

/** Seed the editable tier form from a tier map (configured tiers only). */
export function seedTiers(tiers: SafeConfigTiers['tiers']): TiersForm {
  const row = (t: TierName): TierRowForm => {
    const set = tiers?.[t];
    return { provider: set?.provider ?? '', model: set?.model ?? '', effort: set?.effort ?? '' };
  };
  return { small: row('small'), medium: row('medium'), large: row('large') };
}

/**
 * "provider/model" hint for an unset tier. Install scope falls back to the
 * built-in default; user scope falls back to the install tier first (that is
 * what an unset per-user tier resolves to), then the built-in default.
 */
export function tierDefaultHint(cfg: SafeConfigTiers, t: TierName, scope: SettingsScope): string {
  if (scope === 'user') {
    const installSet = cfg.tiers?.[t];
    if (installSet) return `${installSet.provider}/${installSet.model}`;
  }
  const d = cfg.tierDefaults?.[t];
  return d ? `${d.provider}/${d.model}` : 'built-in default';
}

/** Alias names must start with '@' and may not shadow the reserved tier keywords. */
export function aliasNameError(name: string): string | null {
  const n = name.trim();
  if (n === '' || n === '@') return 'Enter a name after @.';
  if (!n.startsWith('@')) return 'Names start with @.';
  if (['@small', '@medium', '@large'].includes(n.toLowerCase()))
    return 'small, medium and large are reserved.';
  return null;
}

/** Tier map for the active scope. User scope never falls back to install values. */
export function tiersForScope(
  scope: SettingsScope,
  config: SafeConfigTiers,
  prefs: UserAiPrefs | undefined
): SafeConfigTiers['tiers'] {
  return scope === 'user' ? prefs?.tiers : config.tiers;
}

/** Alias map for the active scope. User scope never falls back to install values. */
export function aliasesForScope(
  scope: SettingsScope,
  config: { aliases?: Record<string, TierEntry> },
  prefs: UserAiPrefs | undefined
): Record<string, TierEntry> | undefined {
  return scope === 'user' ? prefs?.aliases : config.aliases;
}

/** Editable draft of the per-user default assistant and chat model. */
export interface UserDefaultDraft {
  provider: string;
  model: string;
}

export function seedUserDefault(prefs: UserAiPrefs): UserDefaultDraft {
  return { provider: prefs.defaultProvider ?? '', model: prefs.defaultModel ?? '' };
}

/**
 * Arguments for the atomic per-user default write. A blank provider clears both
 * fields; a blank model clears only the pin, so a stale model can never ride a
 * provider switch.
 */
export function userDefaultArgs(draft: UserDefaultDraft): [string | null, string | null] {
  if (draft.provider === '') return [null, null];
  return [draft.provider, draft.model === '' ? null : draft.model];
}
