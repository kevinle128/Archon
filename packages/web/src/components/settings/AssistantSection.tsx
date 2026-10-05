import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateAssistantConfig } from '@/lib/api';
import type { ProviderInfo } from '@/lib/api';
import { updateUserDefault } from '@/lib/settings/api';
import {
  buildAssistantUpdate,
  seedUserDefault,
  userDefaultArgs,
} from '@/lib/settings/form-builders';
import type { UserDefaultDraft } from '@/lib/settings/form-builders';
import {
  useConfigQuery,
  usePiModelsQuery,
  useProviderKeysQuery,
  useProvidersQuery,
  useUserPrefsQuery,
} from '@/lib/settings/hooks';
import { settingsKeys } from '@/lib/settings/query-keys';
import type { AssistantConfigForm, SafeConfig } from '@/lib/settings/types';
import { ModelPickerField } from './ModelPickerField';
import {
  Btn,
  Field,
  HelpText,
  InlineError,
  LoadingLine,
  SelectInput,
  SettingsSection,
  TextInput,
} from './primitives';

const WEB_SEARCH_MODES = ['disabled', 'cached', 'live'] as const;

/** Read a string field off the open provider-defaults record; '' when absent or not a string. */
function readStr(rec: SafeConfig['assistants'][string] | undefined, key: string): string {
  const v = rec?.[key];
  return typeof v === 'string' ? v : '';
}

/** Seed editable form state from the saved config and the registered providers. */
function seedForm(config: SafeConfig, providers: ProviderInfo[]): AssistantConfigForm {
  const models: Record<string, string> = {};
  for (const p of providers) models[p.id] = readStr(config.assistants[p.id], 'model');
  const codex = config.assistants.codex;
  return {
    assistant: config.assistant,
    models,
    modelReasoningEffort: readStr(codex, 'modelReasoningEffort'),
    webSearchMode: readStr(codex, 'webSearchMode'),
  };
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Install-wide default assistant and per-provider model (PATCH /api/config/assistants),
 * plus the caller's own default assistant and chat model (PATCH
 * /api/auth/me/ai-prefs/default) when a web identity exists. Model strings are
 * never validated here: pickers guide, the SDK is the source of truth.
 */
export function AssistantSection(): ReactElement {
  const queryClient = useQueryClient();
  const { data: config, error: configError } = useConfigQuery();
  const { data: providers, error: providersError } = useProvidersQuery();
  const { data: userPrefs, error: userPrefsError } = useUserPrefsQuery();
  const { data: keyData } = useProviderKeysQuery();
  const { data: piModels } = usePiModelsQuery();
  const agents = keyData?.agents;
  const userScopeAvailable = userPrefsError === null;

  const [form, setForm] = useState<AssistantConfigForm | null>(null);
  const [baseline, setBaseline] = useState('');
  useEffect(() => {
    if (config === undefined || providers === undefined) return;
    const seeded = seedForm(config.config, providers);
    setForm(seeded);
    setBaseline(JSON.stringify(seeded));
  }, [config, providers]);

  const [userDraft, setUserDraft] = useState<UserDefaultDraft | null>(null);
  const [userBaseline, setUserBaseline] = useState('');
  useEffect(() => {
    if (userPrefs === undefined) return;
    const seeded = seedUserDefault(userPrefs);
    setUserDraft(seeded);
    setUserBaseline(JSON.stringify(seeded));
  }, [userPrefs]);

  const save = useMutation({
    mutationFn: (f: AssistantConfigForm) => updateAssistantConfig(buildAssistantUpdate(f)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.config }),
  });

  const saveUser = useMutation({
    mutationFn: (draft: UserDefaultDraft) => updateUserDefault(...userDefaultArgs(draft)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.userAiPrefs }),
  });

  const loadError = configError ?? providersError;
  const dirty = form !== null && JSON.stringify(form) !== baseline;
  const userDirty = userDraft !== null && JSON.stringify(userDraft) !== userBaseline;

  const patch = (partial: Partial<AssistantConfigForm>): void => {
    setForm(f => (f === null ? f : { ...f, ...partial }));
  };
  const setModel = (id: string, value: string): void => {
    setForm(f => (f === null ? f : { ...f, models: { ...f.models, [id]: value } }));
  };

  const picker = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string
  ): ReactElement => (
    <Field key={id} label={label}>
      {() => (
        <ModelPickerField
          // Re-key per agent so picker-internal state never bleeds across a switch.
          key={id}
          agentId={id}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          selectEmptyLabel="inherit"
          ariaLabel={label}
          className="w-full"
          agents={agents}
          piModels={piModels}
        />
      )}
    </Field>
  );

  const body = ((): ReactElement => {
    if (loadError) {
      return (
        <InlineError>{errorMessage(loadError, 'Failed to load assistant settings.')}</InlineError>
      );
    }
    if (form === null || providers === undefined) return <LoadingLine />;
    const claude = providers.find(p => p.id === 'claude');
    const codex = providers.find(p => p.id === 'codex');
    const others = providers.filter(p => p.id !== 'claude' && p.id !== 'codex');
    return (
      <>
        <div className="grid max-w-[560px] gap-3">
          <Field
            label="Default assistant"
            helper="Used for chat and for workflows that do not name a provider."
          >
            {({ id, describedBy }) => (
              <SelectInput
                id={id}
                aria-describedby={describedBy}
                value={form.assistant}
                onChange={e => {
                  patch({ assistant: e.target.value });
                }}
              >
                {providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        </div>

        {claude ? (
          <div className="grid gap-4">
            <h3 className="text-sm font-semibold text-text-primary">{claude.displayName}</h3>
            <div className="max-w-[560px]">
              {picker(
                'claude',
                'Model',
                form.models.claude ?? '',
                v => {
                  setModel('claude', v);
                },
                'sonnet, opus, haiku'
              )}
            </div>
          </div>
        ) : null}

        {codex ? (
          <div className="grid gap-4">
            <h3 className="text-sm font-semibold text-text-primary">{codex.displayName}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {picker(
                'codex',
                'Model',
                form.models.codex ?? '',
                v => {
                  setModel('codex', v);
                },
                'gpt-6-sol'
              )}
              <Field label="Reasoning effort">
                {({ id }) => (
                  <TextInput
                    id={id}
                    className="font-mono"
                    value={form.modelReasoningEffort}
                    onChange={e => {
                      patch({ modelReasoningEffort: e.target.value });
                    }}
                    placeholder="inherit (e.g. xhigh)"
                  />
                )}
              </Field>
              <Field label="Web search">
                {({ id }) => (
                  <SelectInput
                    id={id}
                    value={form.webSearchMode}
                    onChange={e => {
                      patch({ webSearchMode: e.target.value });
                    }}
                  >
                    <option value="">inherit</option>
                    {WEB_SEARCH_MODES.map(m => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
            </div>
          </div>
        ) : null}

        {others.length > 0 ? (
          <div className="grid gap-4">
            <h3 className="text-sm font-semibold text-text-primary">Other assistants</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {others.map(p =>
                picker(
                  p.id,
                  `${p.displayName} model`,
                  form.models[p.id] ?? '',
                  v => {
                    setModel(p.id, v);
                  },
                  'blank = SDK default'
                )
              )}
            </div>
            <HelpText>A blank model leaves the assistant on its SDK default.</HelpText>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Btn
            disabled={!dirty || save.isPending}
            onClick={() => {
              save.mutate(form);
            }}
          >
            {save.isPending ? 'Saving...' : 'Save defaults'}
          </Btn>
          {save.isError ? (
            <InlineError>{errorMessage(save.error, 'Failed to save defaults.')}</InlineError>
          ) : null}
        </div>

        {userScopeAvailable && userDraft !== null ? (
          <div className="grid gap-4 border-t border-border pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-text-primary">Your default model</h3>
              <span className="text-xs text-text-secondary">
                Just me &middot; overrides the install default in chat
              </span>
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto_auto]">
              <Field label="Assistant">
                {({ id }) => (
                  <SelectInput
                    id={id}
                    value={userDraft.provider}
                    disabled={saveUser.isPending}
                    onChange={e => {
                      // A model pin belongs to the provider it was set with; clear it on a switch.
                      setUserDraft({ provider: e.target.value, model: '' });
                    }}
                  >
                    <option value="">Inherit (this install)</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              <Field label="Chat model">
                {() => (
                  <ModelPickerField
                    key={userDraft.provider}
                    agentId={userDraft.provider}
                    value={userDraft.model}
                    onChange={v => {
                      setUserDraft(d => (d === null ? d : { ...d, model: v }));
                    }}
                    disabled={saveUser.isPending || userDraft.provider === ''}
                    placeholder={
                      userDraft.provider === '' ? 'inherit (this install)' : 'blank = tier default'
                    }
                    selectEmptyLabel="tier default"
                    ariaLabel="Chat model"
                    className="w-full"
                    agents={agents}
                    piModels={piModels}
                  />
                )}
              </Field>
              <Btn
                disabled={!userDirty || saveUser.isPending}
                onClick={() => {
                  saveUser.mutate(userDraft);
                }}
              >
                {saveUser.isPending ? 'Saving...' : 'Save mine'}
              </Btn>
              <Btn
                variant="ghost"
                disabled={
                  saveUser.isPending || (userDraft.provider === '' && userDraft.model === '')
                }
                onClick={() => {
                  const cleared = { provider: '', model: '' };
                  setUserDraft(cleared);
                  saveUser.mutate(cleared);
                }}
              >
                Clear
              </Btn>
            </div>
            {saveUser.isError ? (
              <InlineError>
                {errorMessage(saveUser.error, 'Failed to save your default.')}
              </InlineError>
            ) : null}
            <HelpText>
              Chat model order: your default, then the large tier, then the install model for that
              assistant. Workflows still resolve the large tier.
            </HelpText>
          </div>
        ) : null}
      </>
    );
  })();

  return (
    <SettingsSection
      id="set-assistant"
      title="Assistant defaults"
      description="Install-wide default assistant and per-provider model. Workflow and node settings override these."
    >
      {body}
    </SettingsSection>
  );
}
