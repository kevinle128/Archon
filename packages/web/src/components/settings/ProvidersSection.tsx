import { useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteProviderKey,
  listOpencodeCredentials,
  OPENCODE_LOAD_TIMEOUT_MS,
  setProviderKey,
} from '@/lib/settings/api';
import {
  agentReadiness,
  connectionLabel,
  filterCredentials,
  modelCountByBackend,
  splitPiCredentials,
  type AgentReadinessState,
} from '@/lib/settings/agent-status';
import { hasStatus } from '@/lib/settings/http';
import { usePiModelsQuery, useProviderKeysQuery } from '@/lib/settings/hooks';
import { settingsKeys } from '@/lib/settings/query-keys';
import type {
  AgentCredentialStatus,
  AgentCredentials,
  OpencodeCredentialProvider,
  ProviderKeyConnection,
} from '@/lib/settings/types';
import { useCancelledRef } from '@/lib/settings/use-cancelled-ref';
import {
  Btn,
  Field,
  HelpText,
  InlineError,
  LoadingLine,
  SettingsSection,
  StatusPill,
  TextInput,
  type Tone,
} from './primitives';
import { SubscriptionLoginFlow } from './SubscriptionLoginFlow';

const READINESS_TONE: Record<AgentReadinessState, Tone> = {
  ready: 'done',
  'needs-credential': 'warn',
  dynamic: 'pend',
};

const READINESS_LABEL: Record<AgentReadinessState, string> = {
  ready: 'Ready',
  'needs-credential': 'Needs credential',
  dynamic: 'Dynamic',
};

/** Human description of an ambient chain's source for status-only rows. */
function ambientSource(vendor: string): string {
  if (vendor === 'amazon-bedrock') return 'AWS env';
  if (vendor === 'google-vertex') return 'gcloud env';
  if (vendor === 'devin') return 'devin auth login';
  return 'env';
}

const KIND_LABEL: Record<string, string> = {
  api_key: 'API key',
  subscription: 'subscription',
  ambient: 'ambient',
};

/** Connection state text and tone for one credential row. */
function credentialState(
  cred: AgentCredentialStatus,
  label: string | null
): { tone: Tone; text: string } {
  if (cred.connected === 'api_key') {
    return { tone: 'done', text: label ? `API key · ${label}` : 'API key connected' };
  }
  if (cred.connected === 'oauth') return { tone: 'done', text: 'Subscription connected' };
  if (cred.installEnv) return { tone: 'done', text: 'Using install env' };
  if (cred.kinds.includes('ambient')) {
    return cred.ambientConfigured === true
      ? { tone: 'done', text: `Configured via ${ambientSource(cred.vendor)}` }
      : { tone: 'pend', text: 'Not detected' };
  }
  return { tone: 'pend', text: 'Not connected' };
}

function StateText({ tone, children }: { tone: Tone; children: string }): ReactElement {
  const color = tone === 'done' ? 'text-success' : 'text-text-secondary';
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${color}`}>
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${tone === 'done' ? 'bg-current' : 'border border-current'}`}
      />
      {children}
    </span>
  );
}

/** Inline API-key connect form for one vendor. The key is never echoed or logged. */
function KeyConnectForm({
  cred,
  onDone,
}: {
  cred: AgentCredentialStatus;
  onDone: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useCancelledRef();

  const save = async (): Promise<void> => {
    if (apiKey.trim() === '') return;
    setSaving(true);
    setError(null);
    try {
      await setProviderKey(cred.vendor, apiKey.trim(), label.trim() || undefined);
      // Invalidation touches only the query cache, so it is safe after unmount and
      // must run before the guard or a stored key would render as "not connected".
      void queryClient.invalidateQueries({ queryKey: settingsKeys.providerConnections });
      if (cancelledRef.current) return;
      setApiKey('');
      onDone();
    } catch (e: unknown) {
      if (cancelledRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to save key.');
      setSaving(false);
    }
  };

  return (
    <form
      className="col-span-full grid gap-3 rounded-xl border border-border bg-surface p-4"
      onSubmit={e => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,200px)]">
        <Field label={`${cred.displayName} API key`} error={error}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              type="password"
              autoComplete="off"
              className="font-mono"
              value={apiKey}
              onChange={e => {
                setApiKey(e.target.value);
              }}
              placeholder="Paste key"
            />
          )}
        </Field>
        <Field label="Label (optional)">
          {({ id }) => (
            <TextInput
              id={id}
              value={label}
              onChange={e => {
                setLabel(e.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <div className="flex gap-2">
        <Btn type="submit" disabled={saving || apiKey.trim() === ''}>
          {saving ? 'Saving...' : 'Connect'}
        </Btn>
        <Btn variant="ghost" onClick={onDone}>
          Cancel
        </Btn>
      </div>
    </form>
  );
}

function CredentialRow({
  cred,
  label,
  connectEnabled,
  keyFormOpen,
  loginOpen,
  busy,
  modelCount,
  onOpenKeyForm,
  onCloseKeyForm,
  onOpenLogin,
  onCloseLogin,
  onDisconnect,
}: {
  cred: AgentCredentialStatus;
  label: string | null;
  connectEnabled: boolean;
  keyFormOpen: boolean;
  loginOpen: boolean;
  busy: boolean;
  modelCount: number | undefined;
  onOpenKeyForm: () => void;
  onCloseKeyForm: () => void;
  onOpenLogin: () => void;
  onCloseLogin: () => void;
  onDisconnect: () => void;
}): ReactElement {
  // Key connect follows the declared `kinds`, but login follows
  // `subscriptionAvailable`: the server evaluates a runtime gate that can disable a
  // declared subscription kind. The two are deliberately different.
  const canConnectKey = connectEnabled && cred.kinds.includes('api_key') && cred.connected === null;
  const canLogin = connectEnabled && cred.subscriptionAvailable && cred.connected !== 'oauth';
  const canDisconnect = connectEnabled && cred.connected !== null;
  const state = credentialState(cred, label);
  const kinds = cred.kinds.map(k => KIND_LABEL[k] ?? k).join(', ');

  return (
    <div className="grid min-h-11 grid-cols-[minmax(0,160px)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
      <span className="min-w-0">
        <span className="block truncate font-mono text-sm text-text-primary">{cred.vendor}</span>
        <span className="block text-xs text-text-tertiary">
          {kinds}
          {modelCount !== undefined
            ? ` · ${String(modelCount)} model${modelCount === 1 ? '' : 's'}`
            : ''}
        </span>
      </span>
      <StateText tone={state.tone}>{state.text}</StateText>
      <span className="flex flex-wrap justify-end gap-2">
        {canLogin ? (
          <Btn onClick={onOpenLogin} disabled={loginOpen}>
            Log in
          </Btn>
        ) : null}
        {canConnectKey ? (
          <Btn onClick={keyFormOpen ? onCloseKeyForm : onOpenKeyForm}>
            {keyFormOpen ? 'Cancel' : 'Add API key'}
          </Btn>
        ) : null}
        {canDisconnect ? (
          <Btn
            variant="danger"
            onClick={onDisconnect}
            disabled={busy}
            aria-label={`Disconnect ${cred.displayName}`}
          >
            {busy ? 'Disconnecting...' : 'Disconnect'}
          </Btn>
        ) : null}
      </span>
      {keyFormOpen ? <KeyConnectForm cred={cred} onDone={onCloseKeyForm} /> : null}
      {loginOpen ? (
        <SubscriptionLoginFlow
          provider={cred.vendor}
          displayName={cred.displayName}
          onDone={onCloseLogin}
        />
      ) : null}
    </div>
  );
}

/**
 * Searchable "Add backend" picker over Pi's not-yet-connected key backends. Results
 * render only while a query is typed, so the full catalog never renders flat.
 */
function BackendPicker({
  addable,
  modelCounts,
  onPick,
}: {
  addable: AgentCredentialStatus[];
  modelCounts: Map<string, number>;
  onPick: (vendor: string) => void;
}): ReactElement | null {
  const [query, setQuery] = useState('');
  if (addable.length === 0) return null;
  const searching = query.trim() !== '';
  const matches = filterCredentials(addable, query);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <TextInput
            value={query}
            onChange={e => {
              setQuery(e.target.value);
            }}
            placeholder="Add backend"
            aria-label="Search backends to connect"
          />
        </div>
        <span className="text-xs text-text-tertiary">
          {String(addable.length)} Pi backends available
        </span>
      </div>
      {searching && matches.length > 0 ? (
        <div className="max-h-56 overflow-y-auto rounded-[10px] border border-border">
          {matches.map(c => {
            const count = modelCounts.get(c.vendor);
            return (
              <button
                key={c.vendor}
                type="button"
                onClick={() => {
                  setQuery('');
                  onPick(c.vendor);
                }}
                className="flex min-h-11 w-full cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-elevated motion-reduce:transition-none"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="text-text-primary">{c.displayName}</span>
                  <span className="font-mono text-xs text-text-tertiary">{c.vendor}</span>
                </span>
                {count !== undefined ? (
                  <span className="shrink-0 text-xs text-text-tertiary">
                    {String(count)} model{count === 1 ? '' : 's'}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {searching && matches.length === 0 ? <HelpText>No backend matches.</HelpText> : null}
    </div>
  );
}

type OpencodePhase = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * OpenCode's dynamic backend list. The endpoint boots the embedded runtime, so
 * nothing loads until the user asks. Any failure (503, network, timeout) gets a
 * retry instead of a dead card.
 */
function OpencodeBackends(): ReactElement {
  const [phase, setPhase] = useState<OpencodePhase>('idle');
  const [providers, setProviders] = useState<OpencodeCredentialProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useCancelledRef();

  const load = async (): Promise<void> => {
    setPhase('loading');
    setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        listOpencodeCredentials(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Timed out waiting for the OpenCode runtime. Retry.'));
          }, OPENCODE_LOAD_TIMEOUT_MS);
        }),
      ]);
      if (cancelledRef.current) return;
      setProviders(result);
      setPhase('loaded');
    } catch (e: unknown) {
      if (cancelledRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load OpenCode backends.');
      setPhase('error');
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <div className="grid gap-3">
      <HelpText>
        Backends and connection state come from the embedded OpenCode runtime. Connections are
        install-wide, not per-user.
      </HelpText>
      {phase === 'idle' ? (
        <div>
          <Btn onClick={() => void load()}>Inspect backends</Btn>
        </div>
      ) : null}
      {phase === 'loading' ? (
        <LoadingLine>
          Loading backends. Starting the OpenCode runtime can take a moment.
        </LoadingLine>
      ) : null}
      {phase === 'error' ? (
        <div className="flex flex-wrap items-center gap-3">
          {error ? <InlineError>{error}</InlineError> : null}
          <Btn onClick={() => void load()}>Retry</Btn>
        </div>
      ) : null}
      {phase === 'loaded' ? (
        <>
          <div className="max-h-72 overflow-y-auto">
            {providers.map(p => (
              <div
                key={p.id}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border py-2 last:border-b-0"
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="text-sm text-text-primary">{p.name}</span>
                  <span className="font-mono text-xs text-text-tertiary">{p.id}</span>
                  {p.connected ? <span className="text-xs text-success">connected</span> : null}
                </span>
                <span className="flex items-baseline gap-3 text-xs text-text-tertiary">
                  <span>
                    {String(p.modelCount)} model{p.modelCount === 1 ? '' : 's'}
                  </span>
                  {p.authMethods.length > 0 ? (
                    <span>{p.authMethods.map(m => m.label).join(' · ')}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          <div>
            <Btn variant="ghost" onClick={() => void load()}>
              Refresh
            </Btn>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** One agent: name and readiness on the left, its credentials on the right. */
function AgentCard({
  agent,
  connections,
  connectEnabled,
  piModelCounts,
}: {
  agent: AgentCredentials;
  connections: ProviderKeyConnection[];
  connectEnabled: boolean;
  piModelCounts: Map<string, number>;
}): ReactElement {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  // At most one inline flow per card: an API-key form or a login flow.
  const [keyVendor, setKeyVendor] = useState<string | null>(null);
  const [loginVendor, setLoginVendor] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const cancelledRef = useCancelledRef();

  const disconnect = async (vendor: string): Promise<void> => {
    setDisconnecting(vendor);
    setMessage(null);
    try {
      await deleteProviderKey(vendor);
      void queryClient.invalidateQueries({ queryKey: settingsKeys.providerConnections });
    } catch (e: unknown) {
      if (cancelledRef.current) return;
      setMessage(e instanceof Error ? e.message : 'Disconnect failed.');
    } finally {
      if (!cancelledRef.current) setDisconnecting(null);
    }
  };

  const readiness = agentReadiness(agent);
  const isMultiBackend = agent.catalog === 'static' && agent.credentials.length > 1;
  const groups = isMultiBackend ? splitPiCredentials(agent) : null;
  const inlineRows = groups ? groups.active : agent.credentials;
  const pickedAddable =
    groups && keyVendor !== null ? groups.addable.find(c => c.vendor === keyVendor) : undefined;

  const row = (cred: AgentCredentialStatus): ReactElement => (
    <CredentialRow
      key={cred.vendor}
      cred={cred}
      label={connectionLabel(connections, cred.vendor)}
      connectEnabled={connectEnabled}
      keyFormOpen={keyVendor === cred.vendor}
      loginOpen={loginVendor === cred.vendor}
      busy={disconnecting === cred.vendor}
      modelCount={isMultiBackend ? piModelCounts.get(cred.vendor) : undefined}
      onOpenKeyForm={() => {
        setKeyVendor(cred.vendor);
        setLoginVendor(null);
      }}
      onCloseKeyForm={() => {
        setKeyVendor(null);
      }}
      onOpenLogin={() => {
        setLoginVendor(cred.vendor);
        setKeyVendor(null);
      }}
      onCloseLogin={() => {
        setLoginVendor(null);
      }}
      onDisconnect={() => void disconnect(cred.vendor)}
    />
  );

  return (
    <div className="grid gap-x-6 gap-y-4 border-b border-border py-4 last:border-b-0 md:grid-cols-[200px_minmax(0,1fr)]">
      <div className="grid content-start justify-items-start gap-1">
        <b className="font-medium text-text-primary">{agent.displayName}</b>
        <span className="font-mono text-xs text-text-tertiary">{agent.id}</span>
        <StatusPill tone={READINESS_TONE[readiness.state]}>
          {READINESS_LABEL[readiness.state]}
        </StatusPill>
        <span className="text-xs text-text-tertiary">{readiness.detail}</span>
      </div>

      <div className="grid min-w-0 gap-3">
        {agent.catalog === 'dynamic' ? (
          <OpencodeBackends />
        ) : (
          <>
            {inlineRows.length > 0 ? inlineRows.map(row) : null}
            {inlineRows.length === 0 && isMultiBackend ? (
              <HelpText>No backends connected yet.</HelpText>
            ) : null}
            {groups && connectEnabled ? (
              <BackendPicker
                addable={groups.addable}
                modelCounts={piModelCounts}
                onPick={vendor => {
                  setKeyVendor(vendor);
                  setLoginVendor(null);
                }}
              />
            ) : null}
            {pickedAddable ? row(pickedAddable) : null}
            {groups && groups.ambient.length > 0 ? (
              <div className="grid gap-1 border-t border-border pt-3">
                {groups.ambient.map(cred => (
                  <div
                    key={cred.vendor}
                    className="flex min-h-9 items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-text-secondary">
                      {cred.displayName}{' '}
                      <span className="font-mono text-xs text-text-tertiary">{cred.vendor}</span>
                    </span>
                    <span
                      className={
                        cred.ambientConfigured === true
                          ? 'text-xs text-success'
                          : 'text-xs text-text-tertiary'
                      }
                    >
                      {cred.ambientConfigured === true
                        ? `Configured via ${ambientSource(cred.vendor)}`
                        : 'Not detected'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {agent.credentials.length === 0 ? (
              <HelpText>Uses the agent's own CLI login. No Archon credential needed.</HelpText>
            ) : null}
          </>
        )}
        {message !== null ? <InlineError>{message}</InlineError> : null}
      </div>
    </div>
  );
}

/**
 * Per-agent credential cards from the grouped GET /api/auth/providers matrix. The
 * section hides on a 401 (no web identity: nothing per-user to manage). With
 * per-user keys disabled the cards still render as install-level status and only
 * the connect actions hide.
 */
export function ProvidersSection(): ReactElement | null {
  const { data, error } = useProviderKeysQuery();
  const { data: piModels } = usePiModelsQuery();

  if (hasStatus(error, 401)) return null;

  const wrap = (children: ReactElement, aside?: ReactElement): ReactElement => (
    <SettingsSection
      id="set-providers"
      title="AI providers"
      description="API keys and subscription logins, stored encrypted per user. Runs use the credentials of the person who starts them."
      aside={aside}
    >
      {children}
    </SettingsSection>
  );

  if (error) {
    return wrap(
      <InlineError>
        {error instanceof Error ? error.message : 'Failed to load providers.'}
      </InlineError>
    );
  }
  if (data === undefined) return wrap(<LoadingLine />);

  const piModelCounts = modelCountByBackend(piModels);
  // A server predating the grouped API can answer 200 without `agents`; render an
  // empty list rather than crash.
  const agents = data.agents ?? [];

  return wrap(
    <>
      {!data.enabled ? (
        <HelpText>
          Per-user credentials are disabled on this install (no TOKEN_ENCRYPTION_KEY). Showing
          install-level status only.
        </HelpText>
      ) : null}
      {agents.length === 0 ? (
        <HelpText>No agents registered.</HelpText>
      ) : (
        <div className="border-t border-border">
          {agents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              connections={data.connections}
              connectEnabled={data.enabled}
              piModelCounts={piModelCounts}
            />
          ))}
        </div>
      )}
    </>,
    data.enabled ? <StatusPill tone="done">Vault active</StatusPill> : undefined
  );
}
