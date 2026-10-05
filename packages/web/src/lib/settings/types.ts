/**
 * Shared settings types. Credential, OAuth and Pi/OpenCode shapes mirror the
 * server schemas in `server/.../provider-key.schemas.ts` and `provider.schemas.ts`;
 * tier/alias/prefs shapes mirror `config.schemas.ts`.
 */
import type { components } from '@/lib/api.generated';

export type SafeConfig = components['schemas']['SafeConfig'];
export interface ConfigResponse {
  config: SafeConfig;
  database: string;
}
export type UpdateAssistantConfigBody = components['schemas']['UpdateAssistantConfigBody'];

export interface ProviderKeyConnection {
  provider: string;
  kind: 'api_key' | 'oauth';
  label: string | null;
}

/** How a credential can authenticate (mirrors CREDENTIAL_KINDS in @archon/providers). */
export type CredentialKindOption = 'api_key' | 'subscription' | 'ambient';

/**
 * One credential a given agent can consume, with the caller's connection
 * state and server-side detection (install env / ambient). Mirrors
 * `agentCredentialStatusSchema` in `server/.../provider-key.schemas.ts`.
 */
export interface AgentCredentialStatus {
  /** Vendor-canonical credential id (e.g. 'anthropic', 'openrouter'). */
  vendor: string;
  displayName: string;
  kinds: CredentialKindOption[];
  /** The calling user's stored connection for this vendor, or null. */
  connected: 'api_key' | 'oauth' | null;
  /** Whether subscription (OAuth) login is currently connectable (gates included). */
  subscriptionAvailable: boolean;
  /** Whether the server process env already carries this vendor's key. */
  installEnv: boolean;
  /** Ambient chains only (bedrock/vertex): detected in the server environment. */
  ambientConfigured?: boolean;
}

/**
 * One agent's credential surface . `catalog: 'dynamic'`
 * (OpenCode) means the vendor set is resolved at runtime via
 * GET /api/providers/opencode/credentials; `credentials` is empty and `ready`
 * is always false for those.
 */
export interface AgentCredentials {
  /** Agent provider id (registry order preserved by the server). */
  id: string;
  displayName: string;
  catalog: 'static' | 'dynamic';
  /**
   * Whether at least one credential is usable (connected / install env /
   * ambient). Server-computed source of truth for the card readiness verdict
   * (`agentReadiness` in lib/agent-status.ts reads it; the client only
   * derives the human reason label from `credentials`).
   */
  ready: boolean;
  credentials: AgentCredentialStatus[];
}

export interface ProviderKeyList {
  /** False when the install has no TOKEN_ENCRYPTION_KEY — connect affordances hide. */
  enabled: boolean;
  connections: ProviderKeyConnection[];
  /** Server-owned catalog of connectable vendor ids (no client duplication). */
  available: string[];
  /**
   * Subset of `available` that supports subscription (OAuth) login
   * (anthropic, openai, github-copilot since the #1924 gate lift).
   */
  subscriptionAvailable: string[];
  /**
   * Agent → credential matrix (). Two consumers: the Settings → Agents
   * cards and the readiness hints in the Model Tiers / Aliases provider
   * dropdowns (both read the shared `K.providerConnections` cache entry).
   */
  agents: AgentCredentials[];
}

export interface ProviderKeySetResult {
  success: boolean;
  provider: string;
  kind: 'api_key';
  label: string | null;
}

/** POST /api/auth/providers/:provider/oauth/start response. */
export interface ProviderOAuthStart {
  sessionId: string;
  mode: 'manual' | 'device';
  url?: string;
  userCode?: string;
  verificationUri?: string;
  expiresIn: number;
}

/** POST /api/auth/providers/:provider/oauth/poll response. */
export interface ProviderOAuthPoll {
  status: 'pending' | 'connected' | 'error';
  mode?: 'manual' | 'device';
  url?: string;
  userCode?: string;
  verificationUri?: string;
  detail?: string;
}

/**
 * One Pi catalog model — drives the cost/reasoning hint next to Pi tier
 * models. Inline-typed until a regen lands PiModelInfo in api.generated
 * (same convention as the tiers block in skills/settings.ts).
 */
export interface PiModelInfo {
  /** Full model ref as used in `model:` fields: '<pi-provider>/<model-id>' */
  ref: string;
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  /** USD per million tokens, including cache rates and optional tiers. */
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tiers?: {
      inputTokensAbove: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }[];
  };
  contextWindow: number;
}

/**
 * One OpenCode backend provider, introspected from the embedded runtime.
 * Inline-typed (mirrors `opencodeCredentialProviderSchema` in
 * `server/.../provider.schemas.ts`) until a regen lands it in api.generated.
 */
export interface OpencodeCredentialProvider {
  id: string;
  name: string;
  /** Env var names OpenCode reads for this backend. */
  env: string[];
  /** Install-wide: OpenCode's auth store is server-global, not per-user. */
  connected: boolean;
  modelCount: number;
  authMethods: { type: 'oauth' | 'api'; label: string }[];
}

/**
 * A tier preset as the UI handles it. `thinking` is intentionally omitted — there
 * is no UI control for it, and the PATCH /api/config/tiers handler drops it on
 * write, so saving a tier here clears any `thinking` set in config.yaml. Known
 * limitation (advanced; rare).
 */
export interface TierEntry {
  provider: string;
  model: string;
  effort?: string;
}

export interface TiersMap {
  small?: TierEntry;
  medium?: TierEntry;
  large?: TierEntry;
}

/** `SafeConfig` + the tier fields not yet in the generated spec. */
export type SafeConfigTiers = SafeConfig & { tiers?: TiersMap; tierDefaults?: TiersMap };

export interface UpdateTiersBody {
  tiers: { small?: TierEntry | null; medium?: TierEntry | null; large?: TierEntry | null };
}

export type TierName = 'small' | 'medium' | 'large';

export interface TierRowForm {
  provider: string; // '' = unset (falls back to the built-in default)
  model: string;
  effort: string;
}

export type TiersForm = Record<TierName, TierRowForm>;

/** `SafeConfig` + the alias field not yet in the generated spec. */
export type SafeConfigAliases = SafeConfig & { aliases?: Record<string, TierEntry> };

export interface UpdateAliasesBody {
  aliases: Record<string, TierEntry | null>;
}

/**
 * The current web user's personal AI prefs (raw per-user layer, not merged
 * with config). Reads 401 when no web identity resolves.
 */
export interface UserAiPrefs {
  tiers?: TiersMap;
  aliases?: Record<string, TierEntry>;
  defaultProvider?: string;
  /** Per-user default CHAT model; only meaningful with defaultProvider. */
  defaultModel?: string;
}

/** The editable scope of a settings section: install-wide config vs per-user DB prefs. */
export type SettingsScope = 'install' | 'user';

/** One editable alias row. */
export interface AliasRowForm {
  name: string;
  provider: string;
  model: string;
  effort: string;
}

/**
 * Editable assistant form state. `models` is providerId -> free-text model
 * (model strings are intentionally unvalidated: SDKs ship models faster than
 * Archon can enumerate them).
 */
export interface AssistantConfigForm {
  assistant: string;
  models: Record<string, string>;
  modelReasoningEffort: string;
  webSearchMode: string;
}
