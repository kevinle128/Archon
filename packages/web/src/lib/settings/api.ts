/**
 * Network calls for the settings page that `@/lib/api` does not wrap: per-user
 * provider credentials, subscription login, Pi/OpenCode catalogs, tier/alias
 * config writes, and per-user AI prefs. Config read, assistant write, provider
 * list, GitHub identity and codebase calls come from `@/lib/api`.
 */
import { requestJson } from './http';
import type {
  ConfigResponse,
  OpencodeCredentialProvider,
  PiModelInfo,
  ProviderKeyList,
  ProviderKeySetResult,
  ProviderOAuthPoll,
  ProviderOAuthStart,
  UpdateAliasesBody,
  UpdateTiersBody,
  UserAiPrefs,
} from './types';

/** Begin a subscription (OAuth) login, held server-side by the oauth-bridge. */
export function startProviderOAuth(provider: string): Promise<ProviderOAuthStart> {
  return requestJson<ProviderOAuthStart>(
    `/api/auth/providers/${encodeURIComponent(provider)}/oauth/start`,
    { method: 'POST' }
  );
}

/**
 * Poll a held login. For `manual` logins submit the pasted `code`; for `device`
 * logins call with no code and poll until `connected`. The provider segment only
 * keeps the route under the exempt prefix; the server keys off `sessionId`.
 */
export function pollProviderOAuth(
  provider: string,
  sessionId: string,
  code?: string
): Promise<ProviderOAuthPoll> {
  return requestJson<ProviderOAuthPoll>(
    `/api/auth/providers/${encodeURIComponent(provider)}/oauth/poll`,
    { method: 'POST', body: JSON.stringify(code ? { sessionId, code } : { sessionId }) }
  );
}

/** Rejects with a 401 when there is no web identity (the section then hides). */
export function listProviderKeys(): Promise<ProviderKeyList> {
  return requestJson<ProviderKeyList>('/api/auth/providers');
}

/** Stores the key encrypted server-side; the response never echoes it. */
export function setProviderKey(
  provider: string,
  apiKey: string,
  label?: string
): Promise<ProviderKeySetResult> {
  return requestJson<ProviderKeySetResult>(`/api/auth/providers/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    body: JSON.stringify(label ? { apiKey, label } : { apiKey }),
  });
}

/** Idempotent. */
export function deleteProviderKey(provider: string): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>(`/api/auth/providers/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
}

/** Best-effort: the server returns `{ models: [] }` when the catalog cannot load. */
export function listPiModels(): Promise<PiModelInfo[]> {
  return requestJson<{ models: PiModelInfo[] }>('/api/providers/pi/models').then(r => r.models);
}

/**
 * HEAVYWEIGHT: starts the embedded OpenCode runtime when it is not up. Call only
 * on explicit user action, never on passive page load. Rejects with 503 when the
 * runtime is unavailable.
 */
export function listOpencodeCredentials(): Promise<OpencodeCredentialProvider[]> {
  return requestJson<{ providers: OpencodeCredentialProvider[] }>(
    '/api/providers/opencode/credentials'
  ).then(r => r.providers);
}

/** Client deadline for `listOpencodeCredentials`: booting the runtime is the slow path. */
export const OPENCODE_LOAD_TIMEOUT_MS = 60_000;

/** Install-wide model tiers, written to ~/.archon/config.yaml (per-key merge). */
export function updateTiers(body: UpdateTiersBody): Promise<ConfigResponse> {
  return requestJson<ConfigResponse>('/api/config/tiers', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Install-wide @custom aliases, written to ~/.archon/config.yaml (per-key merge). */
export function updateAliases(body: UpdateAliasesBody): Promise<ConfigResponse> {
  return requestJson<ConfigResponse>('/api/config/aliases', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function getUserAiPrefs(): Promise<UserAiPrefs> {
  return requestJson<UserAiPrefs>('/api/auth/me/ai-prefs');
}

export function updateUserTiers(body: UpdateTiersBody): Promise<UserAiPrefs> {
  return requestJson<UserAiPrefs>('/api/auth/me/ai-prefs/tiers', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function updateUserAliases(body: UpdateAliasesBody): Promise<UserAiPrefs> {
  return requestJson<UserAiPrefs>('/api/auth/me/ai-prefs/aliases', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Set the per-user default assistant and chat model. Written atomically by the
 * server: a null model clears any previous pin, and a model without a provider
 * is rejected with 400.
 */
export function updateUserDefault(
  provider: string | null,
  model: string | null
): Promise<UserAiPrefs> {
  return requestJson<UserAiPrefs>('/api/auth/me/ai-prefs/default', {
    method: 'PATCH',
    body: JSON.stringify({ provider, model }),
  });
}
