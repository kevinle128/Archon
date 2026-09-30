import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateTiers, updateUserTiers } from '@/lib/settings/api';
import { providerOptionHint } from '@/lib/settings/agent-status';
import {
  TIER_ORDER,
  buildTiersUpdate,
  seedTiers,
  tierDefaultHint,
  tiersForScope,
} from '@/lib/settings/form-builders';
import {
  useConfigQuery,
  usePiModelsQuery,
  useProviderKeysQuery,
  useProvidersQuery,
  useUserPrefsQuery,
} from '@/lib/settings/hooks';
import { effortForProviderSwitch } from '@/lib/settings/model-options';
import { settingsKeys } from '@/lib/settings/query-keys';
import type {
  SafeConfigTiers,
  SettingsScope,
  TierName,
  TierRowForm,
  TiersForm,
} from '@/lib/settings/types';
import { ModelPickerField } from './ModelPickerField';
import {
  Btn,
  HelpText,
  InlineError,
  LoadingLine,
  ScopeToggle,
  SelectInput,
  SettingsSection,
  TextInput,
} from './primitives';

/**
 * Editor for the model tiers (small, medium, large mapped to provider and model) in
 * two scopes. "This install" writes PATCH /api/config/tiers; "Just me" writes the
 * caller's prefs via PATCH /api/auth/me/ai-prefs/tiers and is hidden when the prefs
 * read fails (no web identity). A row left on "Default" is sent as an unset, so it
 * falls back to the next layer.
 */
export function ModelTiersSection(): ReactElement {
  const queryClient = useQueryClient();
  const { data: config, error: configError } = useConfigQuery();
  const { data: providers, error: providersError } = useProvidersQuery();
  const { data: userPrefs, error: userPrefsError } = useUserPrefsQuery();
  const { data: keyData } = useProviderKeysQuery();
  const { data: piModels } = usePiModelsQuery();

  // With no web identity the editor stays on install scope, so install values are
  // never mislabeled as "Just me".
  const userScopeAvailable = userPrefsError === null;
  const [scope, setScope] = useState<SettingsScope>('install');

  const [form, setForm] = useState<TiersForm | null>(null);
  const [baseline, setBaseline] = useState('');
  useEffect(() => {
    if (config === undefined) return;
    if (scope === 'user' && userPrefs === undefined) return;
    const seeded = seedTiers(tiersForScope(scope, config.config as SafeConfigTiers, userPrefs));
    setForm(seeded);
    setBaseline(JSON.stringify(seeded));
  }, [config, userPrefs, scope]);

  const save = useMutation({
    mutationFn: async (f: TiersForm) => {
      const body = buildTiersUpdate(f);
      if (scope === 'user') {
        await updateUserTiers(body);
        await queryClient.invalidateQueries({ queryKey: settingsKeys.userAiPrefs });
      } else {
        await updateTiers(body);
        await queryClient.invalidateQueries({ queryKey: settingsKeys.config });
      }
    },
  });

  const wrap = (children: ReactElement): ReactElement => (
    <SettingsSection
      id="set-tiers"
      title="Model tiers"
      description="What small, medium and large resolve to in workflows and chat."
      aside={userScopeAvailable ? <ScopeToggle scope={scope} onChange={setScope} /> : undefined}
    >
      {children}
    </SettingsSection>
  );

  const loadError = configError ?? providersError;
  if (loadError) {
    return wrap(
      <InlineError>
        {loadError instanceof Error ? loadError.message : 'Failed to load tiers.'}
      </InlineError>
    );
  }
  if (form === null || providers === undefined || config === undefined)
    return wrap(<LoadingLine />);

  const cfg = config.config as SafeConfigTiers;
  const dirty = JSON.stringify(form) !== baseline;
  const setRow = (t: TierName, partial: Partial<TierRowForm>): void => {
    setForm(f => (f === null ? f : { ...f, [t]: { ...f[t], ...partial } }));
  };
  const supportsEffort = (providerId: string): boolean =>
    providers.find(p => p.id === providerId)?.capabilities.effortControl === true;
  const setCount = TIER_ORDER.filter(t => form[t].provider !== '').length;

  return wrap(
    <>
      <div className="grid gap-1">
        <div className="hidden grid-cols-[96px_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,0.8fr)] gap-3 text-xs font-medium text-text-secondary md:grid">
          <span>Tier</span>
          <span>Provider</span>
          <span>Model</span>
          <span>Effort</span>
        </div>
        {TIER_ORDER.map(tier => {
          const row = form[tier];
          const unset = row.provider === '';
          const hint = tierDefaultHint(cfg, tier, scope);
          return (
            <div
              key={tier}
              className="grid items-center gap-3 py-2 md:grid-cols-[96px_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]"
            >
              <span className="font-mono text-sm font-medium text-text-primary">{tier}</span>
              <SelectInput
                aria-label={`${tier} provider`}
                value={row.provider}
                onChange={e => {
                  const provider = e.target.value;
                  setRow(tier, {
                    provider,
                    effort: effortForProviderSwitch(supportsEffort(provider), row.effort),
                  });
                }}
              >
                <option value="">Default ({hint})</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                    {providerOptionHint(keyData?.agents, p.id)}
                  </option>
                ))}
              </SelectInput>
              <ModelPickerField
                // Re-key per agent so picker state never bleeds across a provider switch.
                key={row.provider}
                agentId={row.provider}
                value={row.model}
                onChange={v => {
                  setRow(tier, { model: v });
                }}
                disabled={unset}
                placeholder={unset ? `default: ${hint}` : 'model (e.g. opus, gpt-5.5)'}
                ariaLabel={`${tier} model`}
                className="w-full"
                agents={keyData?.agents}
                piModels={piModels}
              />
              {supportsEffort(row.provider) ? (
                <TextInput
                  className="font-mono"
                  value={row.effort}
                  onChange={e => {
                    setRow(tier, { effort: e.target.value });
                  }}
                  disabled={unset}
                  aria-label={`${tier} effort`}
                  placeholder="effort"
                />
              ) : (
                <span aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {setCount === 1 ? (
        <HelpText>
          Only one tier is set{scope === 'user' ? ' for you' : ''}. Runs asking for the other tiers
          fall back to the nearest configured preset.
        </HelpText>
      ) : null}
      {scope === 'user' ? (
        <HelpText>Your rows override the install rows for runs you start.</HelpText>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Btn
          disabled={!dirty || save.isPending}
          onClick={() => {
            save.mutate(form);
          }}
        >
          {save.isPending ? 'Saving...' : 'Save tiers'}
        </Btn>
        <Btn
          variant="ghost"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setForm(JSON.parse(baseline) as TiersForm);
          }}
        >
          Cancel
        </Btn>
        <HelpText>Default marks a built-in preset for the default provider.</HelpText>
      </div>
      {save.isError ? (
        <InlineError>
          {save.error instanceof Error ? save.error.message : 'Failed to save tiers.'}
        </InlineError>
      ) : null}
    </>
  );
}
