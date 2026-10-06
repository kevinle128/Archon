import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { updateAliases, updateUserAliases } from '@/lib/settings/api';
import { providerOptionHint } from '@/lib/settings/agent-status';
import {
  aliasNameError,
  aliasesForScope,
  buildAliasesUpdate,
  seedAliasRows,
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
import type { AliasRowForm, SafeConfigAliases, SettingsScope } from '@/lib/settings/types';
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
 * Editor for `@custom` model aliases in two scopes: "This install" writes
 * PATCH /api/config/aliases, "Just me" writes PATCH /api/auth/me/ai-prefs/aliases
 * and is hidden when the prefs read fails. Removing or renaming a row sends a
 * `null` for the old name because both routes apply a per-key merge.
 */
export function AliasesSection(): ReactElement {
  const queryClient = useQueryClient();
  const { data: config, error: configError } = useConfigQuery();
  const { data: providers, error: providersError } = useProvidersQuery();
  const { data: userPrefs, error: userPrefsError } = useUserPrefsQuery();
  const { data: keyData } = useProviderKeysQuery();
  const { data: piModels } = usePiModelsQuery();

  const userScopeAvailable = userPrefsError === null;
  const [scope, setScope] = useState<SettingsScope>('install');

  const [rows, setRows] = useState<AliasRowForm[] | null>(null);
  const [baseline, setBaseline] = useState('');
  const [baselineNames, setBaselineNames] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  useEffect(() => {
    if (config === undefined) return;
    if (scope === 'user' && userPrefs === undefined) return;
    const map = aliasesForScope(scope, config.config as SafeConfigAliases, userPrefs);
    const seeded = seedAliasRows(map);
    setRows(seeded);
    setBaseline(JSON.stringify(seeded));
    setBaselineNames(Object.keys(map ?? {}));
    setShowErrors(false);
  }, [config, userPrefs, scope]);

  const save = useMutation({
    mutationFn: async (r: AliasRowForm[]) => {
      const body = buildAliasesUpdate(r, baselineNames);
      if (scope === 'user') {
        await updateUserAliases(body);
        await queryClient.invalidateQueries({ queryKey: settingsKeys.userAiPrefs });
      } else {
        await updateAliases(body);
        await queryClient.invalidateQueries({ queryKey: settingsKeys.config });
      }
    },
  });

  const wrap = (children: ReactElement): ReactElement => (
    <SettingsSection
      id="set-aliases"
      title="Aliases"
      description='Custom @names for a provider, model and effort. Use them as model: "@review" in a node.'
      aside={userScopeAvailable ? <ScopeToggle scope={scope} onChange={setScope} /> : undefined}
    >
      {children}
    </SettingsSection>
  );

  const loadError = configError ?? providersError;
  if (loadError) {
    return wrap(
      <InlineError>
        {loadError instanceof Error ? loadError.message : 'Failed to load aliases.'}
      </InlineError>
    );
  }
  if (rows === null || providers === undefined || config === undefined)
    return wrap(<LoadingLine />);

  const dirty = JSON.stringify(rows) !== baseline;
  const supportsEffort = (providerId: string): boolean =>
    providers.find(p => p.id === providerId)?.capabilities.effortControl === true;
  const nameErrors = rows.map(r => aliasNameError(r.name));
  const hasNameError = nameErrors.some(e => e !== null);

  const setRow = (index: number, partial: Partial<AliasRowForm>): void => {
    setRows(rs => (rs === null ? rs : rs.map((r, i) => (i === index ? { ...r, ...partial } : r))));
  };
  const onSave = (): void => {
    if (hasNameError) {
      setShowErrors(true);
      return;
    }
    save.mutate(rows);
  };

  return wrap(
    <>
      {rows.length === 0 ? (
        <HelpText>No aliases saved yet{scope === 'user' ? ' (just you)' : ''}.</HelpText>
      ) : (
        <div className="grid gap-3">
          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto] gap-3 text-xs font-medium text-text-secondary lg:grid">
            <span>Name</span>
            <span>Provider</span>
            <span>Model</span>
            <span>Effort</span>
            <span className="sr-only">Actions</span>
          </div>
          {rows.map((row, i) => {
            const nameError = showErrors ? nameErrors[i] : null;
            return (
              <div
                // Index key is intentional: rows are positional edit buffers and names are
                // editable, so a name key would remount the input mid-keystroke.
                key={i}
                className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto] lg:items-start"
              >
                <div className="grid gap-1">
                  <TextInput
                    className="font-mono"
                    value={row.name}
                    onChange={e => {
                      setRow(i, { name: e.target.value });
                    }}
                    placeholder="@review"
                    aria-label="Alias name"
                    aria-invalid={Boolean(nameError)}
                  />
                  {nameError ? (
                    <p role="alert" className="text-xs text-error">
                      {nameError}
                    </p>
                  ) : null}
                </div>
                <SelectInput
                  aria-label="Provider"
                  value={row.provider}
                  onChange={e => {
                    const provider = e.target.value;
                    setRow(i, {
                      provider,
                      effort: effortForProviderSwitch(supportsEffort(provider), row.effort),
                    });
                  }}
                >
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                      {providerOptionHint(keyData?.agents, p.id)}
                    </option>
                  ))}
                </SelectInput>
                <ModelPickerField
                  key={row.provider}
                  agentId={row.provider}
                  value={row.model}
                  onChange={v => {
                    setRow(i, { model: v });
                  }}
                  placeholder="model (e.g. opus, gpt-5.5)"
                  ariaLabel="Model"
                  className="w-full"
                  agents={keyData?.agents}
                  piModels={piModels}
                />
                {supportsEffort(row.provider) ? (
                  <TextInput
                    className="font-mono"
                    value={row.effort}
                    onChange={e => {
                      setRow(i, { effort: e.target.value });
                    }}
                    aria-label="Effort"
                    placeholder="effort"
                  />
                ) : (
                  <span aria-hidden />
                )}
                <Btn
                  variant="ghost"
                  aria-label={`Remove alias ${row.name}`}
                  onClick={() => {
                    setRows(rs => (rs === null ? rs : rs.filter((_, idx) => idx !== i)));
                  }}
                >
                  Remove
                </Btn>
              </div>
            );
          })}
        </div>
      )}
      <HelpText>
        Names start with @. small, medium and large are reserved.
        {scope === 'user' ? ' Your aliases override install aliases with the same name.' : ''}
      </HelpText>
      <div className="flex flex-wrap items-center gap-3">
        <Btn
          variant="ghost"
          onClick={() => {
            setRows(rs =>
              rs === null
                ? rs
                : [...rs, { name: '@', provider: providers[0]?.id ?? '', model: '', effort: '' }]
            );
          }}
        >
          <Plus aria-hidden strokeWidth={1.75} className="size-4" />
          Add alias
        </Btn>
        <Btn disabled={!dirty || save.isPending} onClick={onSave}>
          {save.isPending ? 'Saving...' : 'Save aliases'}
        </Btn>
      </div>
      {save.isError ? (
        <InlineError>
          {save.error instanceof Error ? save.error.message : 'Failed to save aliases.'}
        </InlineError>
      ) : null}
    </>
  );
}
