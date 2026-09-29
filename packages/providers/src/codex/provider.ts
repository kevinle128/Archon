/**
 * Codex SDK wrapper
 * Provides async generator interface for streaming Codex responses
 */
import {
  Codex,
  type CodexOptions,
  type ThreadOptions,
  type TurnOptions,
  type TurnCompletedEvent,
  type ThreadStartedEvent,
  type Thread,
} from '@openai/codex-sdk';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join as joinPath } from 'node:path';
import type {
  IAgentProvider,
  SendQueryOptions,
  NodeConfig,
  MessageChunk,
  TokenUsage,
  ProviderCapabilities,
  CodexProviderDefaults,
  UsageBreakdown,
} from '../types';
import { STREAM_ABORTED_TERMINAL_REASON } from '../types';
import { toUsageBreakdown } from '../usage-breakdown';
import { parseCodexConfig } from './config';
import { CODEX_CAPABILITIES } from './capabilities';
import { resolveCodexBinaryPath } from './binary-resolver';
import { createLogger } from '@archon/paths';
import { loadMcpConfig } from '../mcp/config';
import {
  hasOpenAdditionalProperties,
  normalizeJsonSchemaForOpenAiStrict,
} from '../shared/structured-output';
import { withResumedOutcome, resumedOutcome } from '../shared/resumed';
import {
  defaultProcessTreeOps,
  collectDescendantPids,
  reapProcessTree,
  type ProcessTreeOps,
} from '../shared/process-tree-reap';
import { findCodexExecRoot } from './process-tree-reap';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('provider.codex');
  return cachedLog;
}

type CodexConfigOverrides = NonNullable<CodexOptions['config']>;
type CodexConfigValue = CodexConfigOverrides[string];

interface ProviderWarning {
  code: string;
  message: string;
}

// Singleton Codex instance (async because binary path resolution is async)
let codexInstance: Codex | null = null;
let codexInitPromise: Promise<Codex> | null = null;

/** Reset singleton state. Exported for tests only. */
export function resetCodexSingleton(): void {
  codexInstance = null;
  codexInitPromise = null;
}

/**
 * Get or create Codex SDK instance.
 */
async function getCodex(configCodexBinaryPath?: string): Promise<Codex> {
  if (codexInstance) return codexInstance;

  if (!codexInitPromise) {
    codexInitPromise = (async (): Promise<Codex> => {
      const codexPathOverride = await resolveCodexBinaryPath(configCodexBinaryPath);
      const instance = new Codex({ codexPathOverride });
      codexInstance = instance;
      return instance;
    })().catch(err => {
      codexInitPromise = null;
      throw err;
    });
  }
  return codexInitPromise;
}

/**
 * Resolve Codex's `modelReasoningEffort` from Archon's inputs.
 *
 * Precedence: `nodeConfig.effort` > `assistants.codex.modelReasoningEffort`
 * from config.yaml — mirroring Copilot's `resolveCopilotReasoning`, so a workflow's
 * declared depth beats the install default on both providers alike.
 *
 * The provider owns this vocabulary, so Archon passes a non-empty node value
 * through unchanged and lets the Codex CLI/API validate it.
 */
function resolveModelReasoningEffort(
  nodeConfig: NodeConfig | undefined,
  configured: CodexProviderDefaults['modelReasoningEffort']
): CodexProviderDefaults['modelReasoningEffort'] {
  const declared = nodeConfig?.effort;
  if (declared === undefined) return configured;
  if (declared.length === 0) throw new Error('Codex effort must be a non-empty string.');
  return declared;
}

/**
 * Build thread options for Codex SDK
 */
function buildThreadOptions(
  cwd: string,
  model?: string,
  assistantConfig?: Record<string, unknown>,
  nodeConfig?: NodeConfig
): ThreadOptions {
  const config = parseCodexConfig(assistantConfig ?? {});
  const options = {
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    sandboxMode: 'danger-full-access',
    networkAccessEnabled: true,
    approvalPolicy: 'never',
    model: model ?? config.model,
    // The Codex CLI/API vocabulary can advance before this SDK union. Widen
    // only the provider-owned field and keep every other option type-checked.
    modelReasoningEffort: resolveModelReasoningEffort(
      nodeConfig,
      config.modelReasoningEffort
    ) as ThreadOptions['modelReasoningEffort'],
    webSearchMode: config.webSearchMode,
    additionalDirectories: config.additionalDirectories,
  } satisfies ThreadOptions;
  return options;
}

function buildCodexEnv(requestEnv: Record<string, string>): Record<string, string> {
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  // Managed project env intentionally overrides inherited process env for project-scoped execution.
  return { ...baseEnv, ...requestEnv };
}

function buildMcpEnvSource(
  requestEnv?: Record<string, string>
): Record<string, string | undefined> {
  return requestEnv ? { ...process.env, ...requestEnv } : process.env;
}

const CODEX_MCP_PASSTHROUGH_KEYS = [
  'command',
  'args',
  'env',
  'url',
  'enabled',
  'required',
  'startup_timeout_sec',
  'startup_timeout_ms',
  'tool_timeout_sec',
  'enabled_tools',
  'disabled_tools',
  'supports_parallel_tool_calls',
  'cwd',
  'env_vars',
  'experimental_environment',
  'http_headers',
  'env_http_headers',
  'oauth_resource',
  'scopes',
  'bearer_token_env_var',
  'default_tools_approval_mode',
  'tools',
] as const;

function toCodexConfigValue(value: unknown): CodexConfigValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const result: CodexConfigValue[] = [];
    for (const item of value) {
      const converted = toCodexConfigValue(item);
      if (converted !== undefined) result.push(converted);
    }
    return result;
  }

  if (typeof value === 'object' && value !== null) {
    const result: CodexConfigOverrides = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const converted = toCodexConfigValue(nestedValue);
      if (converted !== undefined) result[key] = converted;
    }
    return result;
  }

  return undefined;
}

function setCodexConfigValue(target: CodexConfigOverrides, key: string, value: unknown): void {
  const converted = toCodexConfigValue(value);
  if (converted !== undefined) {
    target[key] = converted;
  }
}

function convertMcpServerConfigForCodex(
  serverConfig: Record<string, unknown>
): CodexConfigOverrides {
  const result: CodexConfigOverrides = {};

  for (const key of CODEX_MCP_PASSTHROUGH_KEYS) {
    if (key in serverConfig) {
      setCodexConfigValue(result, key, serverConfig[key]);
    }
  }

  // Archon's MCP JSON format uses `headers`; Codex config uses `http_headers`.
  if ('headers' in serverConfig && !('http_headers' in result)) {
    setCodexConfigValue(result, 'http_headers', serverConfig.headers);
  }

  return result;
}

function buildCodexMcpConfigOverrides(
  servers: Record<string, unknown>
): CodexConfigOverrides | undefined {
  const mcpServers: CodexConfigOverrides = {};

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    if (typeof serverConfig !== 'object' || serverConfig === null || Array.isArray(serverConfig)) {
      getLog().warn(
        { serverName, valueType: typeof serverConfig },
        'codex.mcp_server_config_not_object'
      );
      continue;
    }

    const converted = convertMcpServerConfigForCodex(serverConfig as Record<string, unknown>);
    if (Object.keys(converted).length > 0) {
      mcpServers[serverName] = converted;
    }
  }

  if (Object.keys(mcpServers).length === 0) return undefined;
  return { mcp_servers: mcpServers };
}

function isWorkflowNode(requestOptions?: SendQueryOptions): boolean {
  const nodeId = requestOptions?.nodeConfig?.nodeId;
  return typeof nodeId === 'string' && nodeId.trim().length > 0;
}

function withWorkflowSkillCatalogDisabled(config?: CodexConfigOverrides): CodexConfigOverrides {
  return {
    ...(config ?? {}),
    skills: { include_instructions: false },
  };
}

function isWorkflowSkillCatalogConfigUnsupported(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  const namesCatalogSetting =
    normalized.includes('skills.include_instructions') ||
    normalized.includes('include_instructions');
  const isConfigRejection =
    normalized.includes('config') ||
    normalized.includes('unknown field') ||
    normalized.includes('unknown key') ||
    normalized.includes('unrecognized') ||
    normalized.includes('failed to parse');
  return namesCatalogSetting && isConfigRejection;
}

// Maps slugs that ChatGPT-plan accounts now reject (previously shipped as Archon
// suggestions/defaults) to a current, plan-accepted slug to suggest instead.
const CODEX_MODEL_FALLBACKS: Record<string, string> = {
  'gpt-5.3-codex': 'gpt-6-sol',
  'gpt-5.2-codex': 'gpt-6-sol',
  'gpt-5.2': 'gpt-6-sol',
};

function isModelAccessError(errorMessage: string): boolean {
  const m = errorMessage.toLowerCase();
  const hasModel = m.includes('model');
  const hasAvailabilitySignal =
    m.includes('not available') || m.includes('not found') || m.includes('access denied');
  return hasModel && hasAvailabilitySignal;
}

function buildModelAccessMessage(model?: string): string {
  const normalizedModel = model?.trim();
  const selectedModel = normalizedModel || 'the configured model';
  const suggested = normalizedModel ? CODEX_MODEL_FALLBACKS[normalizedModel] : undefined;

  const fixLine = suggested
    ? `To fix: update your model in ~/.archon/config.yaml:\n  assistants:\n    codex:\n      model: ${suggested}`
    : 'To fix: update your model in ~/.archon/config.yaml to one your account can access.';

  const workflowLine = suggested
    ? `Or set it per-workflow with \`model: ${suggested}\` in workflow YAML.`
    : 'Or set it per-workflow with a valid `model:` in workflow YAML.';

  return `❌ Model "${selectedModel}" is not available for your account.\n\n${fixLine}\n\n${workflowLine}`;
}

const MAX_SUBPROCESS_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
/**
 * Grace window for an operator Stop that races a fresh thread's startup. The
 * Codex SDK only assigns a new thread's id once its internal event parser
 * reaches `thread.started` (measured: interrupt-resume-spike.ts) — killing
 * the child before that line is parsed would lose the only handle the
 * operator could redirect to. `onOperatorInterrupt` defers the actual abort
 * until `thread.id` resolves, or applies it unconditionally after this many
 * ms so Stop can never hang on a thread that never starts. A resumed thread
 * already knows its id synchronously, so this window never applies to it.
 */
export const CODEX_INTERRUPT_THREAD_ID_WAIT_MS = 500;
/** Grace between SIGTERM and SIGKILL for a tool-call descendant that outlives `codex exec`, matching the ACP providers' `reapChild` default. */
const TREE_REAP_TERMINATE_GRACE_MS = 5_000;
const RATE_LIMIT_PATTERNS = ['rate limit', 'too many requests', '429', 'overloaded'];
const AUTH_PATTERNS = [
  'credit balance',
  'unauthorized',
  'authentication',
  'invalid token',
  '401',
  '403',
];
const SUBPROCESS_CRASH_PATTERNS = ['exited with code', 'killed', 'signal', 'codex exec'];

function classifyCodexError(
  errorMessage: string
): 'rate_limit' | 'auth' | 'crash' | 'model_access' | 'unknown' {
  if (isModelAccessError(errorMessage)) return 'model_access';
  const m = errorMessage.toLowerCase();
  if (RATE_LIMIT_PATTERNS.some(p => m.includes(p))) return 'rate_limit';
  if (AUTH_PATTERNS.some(p => m.includes(p))) return 'auth';
  if (SUBPROCESS_CRASH_PATTERNS.some(p => m.includes(p))) return 'crash';
  return 'unknown';
}

// Exported for the usage contract test: it feeds a `satisfies TurnCompletedEvent`
// fixture so a change to the Codex SDK's usage shape is caught at compile time.
export function extractUsageFromCodexEvent(
  event: TurnCompletedEvent,
  requestedModel: string | undefined
): { tokens: TokenUsage; usageBreakdown?: UsageBreakdown } {
  if (!event.usage) {
    getLog().warn({ eventType: event.type }, 'codex.usage_null_on_turn_completed');
    return { tokens: { input: 0, output: 0 } };
  }
  const inputTokens = event.usage.input_tokens;
  const cachedInputTokens = event.usage.cached_input_tokens;
  const outputTokens = event.usage.output_tokens;
  const reasoningTokens = event.usage.reasoning_output_tokens;
  // Legacy TokenUsage.input keeps the SDK total input value unchanged.
  const tokens: TokenUsage = {
    input: inputTokens,
    output: outputTokens,
  };
  const model =
    typeof requestedModel === 'string' && requestedModel.trim() !== ''
      ? requestedModel.trim()
      : null;
  const breakdown = toUsageBreakdown([
    {
      provider: 'openai',
      model,
      modelSource: model ? 'requested' : 'unknown',
      // Non-cached input: clamp when cache exceeds total input rather than go negative.
      inputTokens: Math.max(inputTokens - cachedInputTokens, 0),
      cacheReadTokens: cachedInputTokens,
      outputTokens,
      reasoningTokens,
    },
  ]);
  return {
    tokens,
    ...(breakdown.length > 0 ? { usageBreakdown: breakdown } : {}),
  };
}

// ─── Turn Options Builder ────────────────────────────────────────────────

/**
 * Build turn options for a single Codex turn.
 * Handles output schema from both requestOptions and nodeConfig (workflow path).
 */
function buildTurnOptions(requestOptions?: SendQueryOptions): {
  turnOptions: TurnOptions;
  hasOutputFormat: boolean;
} {
  const turnOptions: TurnOptions = {};
  // Preserve the original precedence: an explicit `outputFormat` wins over
  // `nodeConfig.output_format` even when its `.schema` is undefined. Note the
  // resulting asymmetry: if `outputFormat` is set but `.schema` is undefined,
  // `rawSchema` is undefined (no schema sent) yet `hasOutputFormat` is still
  // true — the stream accumulator runs and JSON.parses the response text.
  const rawSchema =
    requestOptions?.outputFormat !== undefined
      ? requestOptions.outputFormat.schema
      : requestOptions?.nodeConfig?.output_format;
  const hasOutputFormat = !!(
    requestOptions?.outputFormat ?? requestOptions?.nodeConfig?.output_format
  );
  if (rawSchema !== undefined) {
    // OpenAI Structured Outputs strict-mode requires additionalProperties:false
    // on every object schema (HTTP 400 invalid_json_schema otherwise). Workflow
    // authors write portable output_format schemas, so normalize here before
    // handing the schema to the Codex SDK. See issue #1843.
    if (hasOpenAdditionalProperties(rawSchema)) {
      // The normalizer is about to rewrite an open-record `additionalProperties`
      // (e.g. `{ type: 'string' }` or `true`) to `false`. OpenAI would 400 the
      // open form anyway, but the author never declared a closed object — warn
      // so the silent narrowing is visible rather than a surprise at runtime.
      getLog().warn({ schema: rawSchema }, 'codex.output_format_open_record_closed');
    }
    turnOptions.outputSchema = normalizeJsonSchemaForOpenAiStrict(rawSchema);
  }
  // Signal assignment is intentionally per-attempt (in sendQuery's retry
  // loop), not here. Reusing a single AbortSignal across retries can poison
  // later attempts once any earlier attempt's subprocess is SIGTERM'd.
  // See issue #1266.
  return { turnOptions, hasOutputFormat };
}

// ─── Effective Prompt Builder ────────────────────────────────────────────

/**
 * Fold the request/node-level systemPrompt into the user prompt.
 *
 * The Codex SDK (verified at @openai/codex-sdk 0.144.5) exposes NO
 * instructions/system-prompt channel on ThreadOptions or TurnOptions, so the
 * only delivery mechanism is prepending to the prompt string, separated by
 * the same `---` delimiter augmentPromptForJsonSchema uses. See issue #1837.
 *
 * Precedence mirrors the Pi provider: request-level systemPrompt wins over
 * node-level. Only string / string[] are supported; SystemPromptPreset
 * objects are Claude-specific and dropped with a WARN (the orchestrator
 * already sends non-Claude providers a plain string).
 *
 * The prepend intentionally repeats on EVERY turn, including resumed
 * threads: the provider cannot know whether a resumed session's earlier
 * turns carried the instructions (the session may predate this fix), and
 * both the resume-failure fallback and cold retry attempts start fresh
 * threads where first-turn-only logic would drop the instructions exactly
 * when they are most needed. This matches Claude, which receives the
 * systemPrompt on every query.
 */
function buildEffectivePrompt(prompt: string, requestOptions?: SendQueryOptions): string {
  const raw = requestOptions?.systemPrompt ?? requestOptions?.nodeConfig?.systemPrompt;
  if (raw === undefined) {
    return prompt;
  }
  let systemText: string | undefined;
  if (typeof raw === 'string') {
    systemText = raw;
  } else if (Array.isArray(raw)) {
    systemText = raw.join('\n\n');
  }
  if (systemText === undefined) {
    getLog().warn({ systemPromptType: typeof raw }, 'codex.system_prompt_dropped_preset');
    return prompt;
  }
  if (systemText.trim() === '') {
    return prompt;
  }
  return `${systemText}\n\n---\n\n${prompt}`;
}

// ─── Stream Normalizer ───────────────────────────────────────────────────

/** State maintained across Codex event stream normalization. */
interface CodexStreamState {
  lastTodoListSignature?: string;
  startedToolItemIds: Set<string>;
  completedToolItemIds: Set<string>;
}

/**
 * Codex restarts its own item numbering (`item_1`, `item_2`, …) on every
 * turn — a fresh `thread.runStreamed()` call, not a fresh thread — so the
 * same raw id can name a different tool call on a later turn of the same
 * node execution (a Stop + redirect, or a cold subprocess retry). Scope
 * every emitted id by the turn that produced it, the same per-call-nonce
 * pattern `createDeepseekEventState`/`createGrokAcpEventState` use for their
 * text block ids. Returns the raw (possibly falsy) id unchanged when it is
 * empty, preserving the callers' existing truthiness checks.
 */
function scopedItemId(turnId: string, rawId: string): string {
  return rawId ? `codex-${turnId}:${rawId}` : rawId;
}

function getMcpToolName(item: Record<string, unknown>): string {
  const server = item.server as string | undefined;
  const tool = item.tool as string | undefined;
  const toolInfo = server && tool ? `${server}/${tool}` : (tool ?? server ?? 'MCP tool');
  return `🔌 MCP: ${toolInfo}`;
}

/**
 * Hand-mirrored `FileUpdateChange` shape (the SDK exports `FileChangeItem`
 * but not its `changes[]` member type). Verified at @openai/codex-sdk
 * 0.144.5: `{ path: string; kind: 'add' | 'delete' | 'update' }` — no
 * before/after content, so a diff can never be built from this alone.
 */
interface CodexFileUpdateChange {
  path: string;
  kind: 'add' | 'delete' | 'update';
}

/**
 * Normalizes to the shared presenter's `file` family via Tier-1 name
 * matching (case-folded, `_`/`-` stripped: `apply_patch` -> `applypatch`).
 */
const CODEX_FILE_CHANGE_TOOL_NAME = 'apply_patch';

/** Bound on how much of a changed file's current content becomes preview evidence. */
const FILE_CHANGE_PREVIEW_MAX_BYTES = 65536;

/**
 * Read a changed file's current on-disk content as bounded preview evidence
 * for #4.1. Codex's `file_change` event never carries before/after text, so
 * this is the only honest, non-fabricated content available; a read failure
 * (e.g. the file was removed by a later step) yields `undefined` rather than
 * a thrown error, since the patch itself already succeeded.
 */
async function readFileChangePreview(
  cwd: string,
  relativePath: string
): Promise<{ text: string; truncated: boolean } | undefined> {
  const absolutePath = isAbsolute(relativePath) ? relativePath : joinPath(cwd, relativePath);
  try {
    const buffer = await readFile(absolutePath);
    return {
      text: buffer.subarray(0, FILE_CHANGE_PREVIEW_MAX_BYTES).toString('utf8'),
      truncated: buffer.length > FILE_CHANGE_PREVIEW_MAX_BYTES,
    };
  } catch (error) {
    getLog().debug(
      { relativePath, err: error instanceof Error ? error.message : String(error) },
      'codex.file_change_preview_unreadable'
    );
    return undefined;
  }
}

/** A `codex exec` process and its full descendant tree, captured while alive. */
interface TreeSnapshot {
  readonly rootPid: number;
  readonly descendantPids: readonly number[];
}

/**
 * Normalize raw Codex SDK events into Archon MessageChunks.
 * Handles structured output normalization (Codex returns JSON inline in text).
 *
 * `abortSignal` is the per-attempt controller's signal — the one actually
 * passed to the SDK as `turnOptions.signal` — used for the existing
 * proactive between-events checks and caught around the loop. `cancelSignal`
 * (node-level Cancel) and `interruptSignal` (operator Stop) are the two
 * EXTERNAL signals that can cause it to abort; `buildInterruptedResult`
 * reads them to classify which one did, since the SDK throws the same shape
 * for both (measured: AbortError, "The operation was aborted.").
 */
async function* streamCodexEvents(
  events: AsyncIterable<Record<string, unknown>>,
  hasOutputFormat: boolean,
  threadId: string | null | undefined,
  abortSignal: AbortSignal | undefined,
  cancelSignal: AbortSignal | undefined,
  interruptSignal: AbortSignal | undefined,
  cwd: string,
  surfaceMcpClientErrors = false,
  requestedModel?: string,
  /** Identifies this turn. Defaulted so every call — a fresh turn or a cold
   *  retry of the same one — gets its own scope; injectable for deterministic
   *  tests. See `scopedItemId`. */
  turnId: string = randomUUID(),
  /**
   * Fired synchronously when a `command_execution` item starts — the SDK's
   * own signal that `codex exec` just forked a shell subprocess, and the
   * only reliable moment to snapshot it and its descendants (see
   * `CodexProvider.captureTreeSnapshot`). Never called for `web_search` or
   * `mcp_tool_call` items, neither of which forks a shell to reap.
   */
  onToolStarted?: () => void
): AsyncGenerator<MessageChunk> {
  const state: CodexStreamState = {
    startedToolItemIds: new Set<string>(),
    completedToolItemIds: new Set<string>(),
  };
  let accumulatedText = '';

  // A new thread's id is assigned during the run via the `thread.started` event
  // (the SDK emits it only for new threads), not synchronously on startThread().
  // Capture it so the terminal result chunk surfaces a resumable sessionId —
  // persist_session and suspend/resume depend on it. A resumed thread keeps the
  // snapshot id (no thread.started fires), so the seeded value stays correct.
  let resolvedThreadId: string | null | undefined = threadId;

  // Operator Stop (#8.4): the current turn's abort is interrupt-caused only
  // when the interrupt signal — not the node-level cancel signal — is the one
  // aborted. Cancel dominates whenever both fire (matches the DeepSeek/OMP
  // adapters). Yielding a marked result instead of throwing means the thread
  // id survives to the dag-executor's resume path even though Codex never
  // produces a clean terminal event on abort (measured: always throws).
  //
  // `isError`/`errorSubtype` ride alongside `terminalReason` even though the
  // executor's interrupt check only needs the terminal reason: when the
  // executor does NOT recognize this turn as operator-interrupted (a stale
  // or spoofed signal), the same shape must still fail the node loudly
  // through the ordinary SDK-error path rather than complete on truncated
  // output. Mirrors the DeepSeek adapter's exact abort triple.
  const buildInterruptedResult = (): Extract<MessageChunk, { type: 'result' }> | undefined => {
    if (cancelSignal?.aborted === true) return undefined;
    if (interruptSignal?.aborted !== true) return undefined;
    return {
      type: 'result',
      ...(resolvedThreadId ? { sessionId: resolvedThreadId } : {}),
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
      isError: true,
      errorSubtype: STREAM_ABORTED_TERMINAL_REASON,
    };
  };

  if (abortSignal?.aborted) {
    const interrupted = buildInterruptedResult();
    if (interrupted) {
      getLog().info({ threadId: resolvedThreadId }, 'codex.query_interrupted_before_stream');
      yield interrupted;
      return;
    }
    getLog().info('query_aborted_before_stream');
    throw new Error('Query aborted');
  }

  // If the iterator closes without a terminal event (e.g. the model was
  // rejected before the turn even started), we synthesize a fail-stop result
  // after the loop so the dag-executor's `msg.isError` branch catches it
  // — matching Claude's contract. Both terminal branches below `return`,
  // so reaching the post-loop block can only mean no terminal fired.
  let lastNonMcpError: string | undefined;

  try {
    for await (const event of events) {
      if (abortSignal?.aborted) {
        getLog().info('query_aborted_between_events');
        throw new Error('Query aborted');
      }

      if (event.type === 'thread.started') {
        // Capture the new thread's id. Its SDK doc comment reads: "The identifier
        // of the new thread. Can be used to resume the thread later." This is the
        // only place a new thread's id surfaces. `continue` — the event carries no
        // user-facing content, only this metadata.
        const startedThreadId = (event as ThreadStartedEvent).thread_id;
        if (startedThreadId) {
          resolvedThreadId = startedThreadId;
          getLog().info({ threadId: startedThreadId }, 'codex.thread_started');
        } else {
          // The SDK types thread_id as a non-empty string, so this should never
          // fire. If it does, a new thread would surface sessionId: undefined and
          // the dag-executor would treat the run as session-less — silently
          // dropping any persist_session continuity. Warn rather than degrade
          // quietly (CLAUDE.md: Fail Fast + Explicit Errors).
          getLog().warn({ snapshotThreadId: resolvedThreadId }, 'codex.thread_started_missing_id');
        }
        continue;
      }

      if (event.type === 'item.started') {
        const item = event.item as Record<string, unknown>;
        const itemType = item.type as string;
        const itemId = scopedItemId(turnId, item.id as string);
        getLog().debug({ eventType: event.type, itemType, itemId }, 'item_started');

        let toolName: string | undefined;
        if (itemType === 'command_execution') {
          // Fired regardless of whether `item.command` is present below: the
          // SDK has already forked the shell subprocess by the time this
          // event arrives, whether or not it also reports the command text.
          onToolStarted?.();
          if (typeof item.command === 'string' && item.command.length > 0) {
            toolName = item.command;
          } else {
            getLog().warn({ itemId }, 'command_execution_missing_command');
          }
        } else if (itemType === 'web_search') {
          if (typeof item.query === 'string' && item.query.length > 0) {
            toolName = `🔍 Searching: ${item.query}`;
          } else {
            getLog().debug({ itemId }, 'web_search_missing_query');
          }
        } else if (itemType === 'mcp_tool_call') {
          toolName = getMcpToolName(item);
        }

        if (toolName && itemId && !state.startedToolItemIds.has(itemId)) {
          state.startedToolItemIds.add(itemId);
          yield { type: 'tool', toolName, toolCallId: itemId };
        }
        continue;
      }

      if (event.type === 'error') {
        const errorEvent = event as { message: string };
        getLog().error({ message: errorEvent.message }, 'stream_error');
        // MCP client errors are non-fatal — Codex retries internally and may
        // still reach turn.completed. Other errors are captured; whether they
        // are fatal is decided when the stream terminates: turn.completed
        // means the SDK recovered, so the captured error is dropped; loop
        // closure without a terminal means the captured error caused the
        // stream to abort and is surfaced as the failure cause.
        const isMcpClientError = errorEvent.message.toLowerCase().includes('mcp client');
        if (!isMcpClientError) {
          lastNonMcpError = errorEvent.message;
        } else if (surfaceMcpClientErrors) {
          // MCP was explicitly configured for this node — surface MCP client
          // errors as system warnings so the workflow author can diagnose.
          yield { type: 'system', content: `⚠️ ${errorEvent.message}` };
        }
        continue;
      }

      if (event.type === 'turn.failed') {
        const errorObj = (event as { error?: { message?: string } }).error;
        const errorMessage = errorObj?.message ?? 'Unknown error';
        getLog().error({ errorMessage }, 'turn_failed');
        yield {
          type: 'result',
          sessionId: resolvedThreadId ?? undefined,
          isError: true,
          errorSubtype: 'codex_turn_failed',
          errors: [errorMessage],
        };
        return;
      }

      if (event.type === 'item.completed') {
        const item = event.item as Record<string, unknown>;
        const itemType = item.type as string;
        const itemId = scopedItemId(turnId, item.id as string);

        const logContext: Record<string, unknown> = {
          eventType: event.type,
          itemType,
          itemId,
        };
        if (itemType === 'command_execution' && item.command) {
          logContext.command = item.command;
        }
        getLog().debug(logContext, 'item_completed');

        const isToolItem =
          itemType === 'command_execution' ||
          itemType === 'web_search' ||
          itemType === 'mcp_tool_call';
        if (isToolItem) {
          if (state.completedToolItemIds.has(itemId)) {
            getLog().warn({ itemId, itemType }, 'tool_item_duplicate_completion');
            continue;
          }
          state.completedToolItemIds.add(itemId);
          if (!state.startedToolItemIds.has(itemId)) {
            getLog().warn({ itemId, itemType }, 'tool_item_completed_without_start');
          }
        }

        switch (itemType) {
          case 'agent_message':
            if (item.text) {
              // Multiple agent_message items can arrive in one turn (preamble + answer);
              // keep only the last — it's the authoritative structured-output candidate.
              if (hasOutputFormat) accumulatedText = item.text as string;
              yield { type: 'assistant', content: item.text as string, textMode: 'complete' };
            }
            break;

          case 'command_execution':
            if (item.command) {
              const cmd = item.command as string;
              const exitCode = item.exit_code as number | null | undefined;
              const exitSuffix =
                exitCode != null && exitCode !== 0 ? `\n[exit code: ${String(exitCode)}]` : '';
              let toolOutcome: 'success' | 'error' | 'unknown';
              if (exitCode === 0) {
                toolOutcome = 'success';
              } else if (exitCode == null) {
                toolOutcome = 'unknown';
              } else {
                toolOutcome = 'error';
              }
              yield {
                type: 'tool_result',
                toolName: cmd,
                toolOutput: ((item.aggregated_output as string) ?? '') + exitSuffix,
                toolCallId: itemId,
                toolOutcome,
                ...(exitCode != null ? { exitCode } : {}),
                outputState: 'full' as const,
              };
            } else {
              getLog().warn({ itemId }, 'command_execution_missing_command');
            }
            break;

          case 'reasoning':
            if (item.text) {
              yield { type: 'thinking', content: item.text as string };
            }
            break;

          case 'web_search':
            if (item.query) {
              const searchToolName = `🔍 Searching: ${item.query as string}`;
              yield {
                type: 'tool_result',
                toolName: searchToolName,
                toolOutput: '',
                toolCallId: itemId,
                toolOutcome: 'unknown',
                outputState: 'missing' as const,
              };
            } else {
              getLog().debug({ itemId }, 'web_search_missing_query');
            }
            break;

          case 'todo_list': {
            const items = item.items as { text?: string; completed?: boolean }[] | undefined;
            if (Array.isArray(items) && items.length > 0) {
              const normalizedItems = items.map(t => ({
                text: typeof t.text === 'string' ? t.text : '(unnamed task)',
                completed: t.completed ?? false,
              }));
              const signature = JSON.stringify(normalizedItems);
              if (signature !== state.lastTodoListSignature) {
                state.lastTodoListSignature = signature;
                const taskList = normalizedItems
                  .map(t => `${t.completed ? '✅' : '⬜'} ${t.text}`)
                  .join('\n');
                yield { type: 'system', content: `📋 Tasks:\n${taskList}` };
              }
            } else {
              getLog().debug({ itemId }, 'todo_list_empty_or_invalid');
            }
            break;
          }

          case 'file_change': {
            const changeStatus = item.status as string;
            const rawError = 'error' in item ? (item as { error?: unknown }).error : undefined;
            const fileErrorMessage =
              typeof rawError === 'string'
                ? rawError
                : typeof rawError === 'object' && rawError !== null && 'message' in rawError
                  ? String((rawError as { message: unknown }).message)
                  : undefined;

            const changes = item.changes as CodexFileUpdateChange[] | undefined;
            if (changeStatus === 'failed') {
              // Out of scope for #4.1 (successful changes only) — unchanged
              // formatted-message path so a failed patch stays visible.
              if (Array.isArray(changes) && changes.length > 0) {
                const changeList = changes
                  .map(c => {
                    const icon = c.kind === 'add' ? '➕' : c.kind === 'delete' ? '➖' : '📝';
                    return `${icon} ${c.path ?? '(unknown file)'}`;
                  })
                  .join('\n');
                const errorSuffix = fileErrorMessage ? `\n${fileErrorMessage}` : '';
                yield {
                  type: 'system',
                  content: `❌ File changes:\n${changeList}${errorSuffix}`,
                };
              } else {
                getLog().warn({ itemId, status: item.status }, 'file_change_failed_no_changes');
                const failMsg = fileErrorMessage
                  ? `❌ File change failed: ${fileErrorMessage}`
                  : '❌ File change failed';
                yield { type: 'system', content: failMsg };
              }
              break;
            }

            if (!Array.isArray(changes) || changes.length === 0) {
              getLog().debug({ itemId, status: item.status }, 'file_change_no_changes');
              break;
            }

            // Successful patch: one typed tool/tool_result row per changed
            // path, in `changes[]` order, so the shared presenter resolves
            // each to the file family (#4.1). The SDK's own FileUpdateChange
            // never carries before/after content — only {path, kind} — so a
            // diff can never be fabricated here; the honest evidence is the
            // path plus the file's current on-disk content as a bounded
            // preview.
            for (let index = 0; index < changes.length; index++) {
              const change = changes[index];
              if (!change || typeof change.path !== 'string' || change.path.length === 0) {
                getLog().warn({ itemId, index }, 'file_change_entry_missing_path');
                continue;
              }
              const toolCallId = `${itemId}:${String(index)}`;
              yield {
                type: 'tool',
                toolName: CODEX_FILE_CHANGE_TOOL_NAME,
                toolInput: { path: change.path, kind: change.kind },
                toolCallId,
              };
              const preview =
                change.kind === 'delete'
                  ? undefined
                  : await readFileChangePreview(cwd, change.path);
              yield {
                type: 'tool_result',
                toolName: CODEX_FILE_CHANGE_TOOL_NAME,
                toolOutput: preview?.text ?? '',
                toolCallId,
                toolOutcome: 'success',
                outputState:
                  preview === undefined ? 'missing' : preview.truncated ? 'truncated' : 'full',
              };
            }
            break;
          }

          case 'mcp_tool_call': {
            const server = item.server as string | undefined;
            const tool = item.tool as string | undefined;
            const mcpToolName = getMcpToolName(item);

            if ((item.status as string) === 'failed') {
              getLog().warn({ server, tool, error: item.error, itemId }, 'mcp_tool_call_failed');
              const mcpError = item.error as { message?: string } | undefined;
              const errMsg = mcpError?.message
                ? `❌ Error: ${mcpError.message}`
                : '❌ Error: MCP tool failed';
              yield {
                type: 'tool_result',
                toolName: mcpToolName,
                toolOutput: errMsg,
                toolCallId: itemId,
                toolOutcome: 'error',
                outputState: 'full' as const,
              };
            } else {
              let toolOutput = '';
              const mcpResult = item.result as { content?: unknown } | undefined;
              if (mcpResult?.content) {
                if (Array.isArray(mcpResult.content)) {
                  toolOutput = JSON.stringify(mcpResult.content);
                } else {
                  getLog().warn(
                    {
                      itemId,
                      server,
                      tool,
                      resultType: typeof mcpResult.content,
                    },
                    'mcp_tool_call_unexpected_result_shape'
                  );
                }
              }
              yield {
                type: 'tool_result',
                toolName: mcpToolName,
                toolOutput,
                toolCallId: itemId,
                toolOutcome: 'success',
                outputState: 'full' as const,
              };
            }
            break;
          }
        }
      }

      if (event.type === 'turn.completed') {
        getLog().debug('turn_completed');
        const { tokens, usageBreakdown } = extractUsageFromCodexEvent(
          event as TurnCompletedEvent,
          requestedModel
        );

        // Codex returns structured output inline in agent_message text.
        // Normalize: parse as JSON and put on structuredOutput so the
        // dag-executor can handle all providers uniformly.
        let structuredOutput: unknown;
        if (hasOutputFormat && accumulatedText) {
          try {
            structuredOutput = JSON.parse(accumulatedText);
            getLog().debug('codex.structured_output_parsed');
          } catch {
            getLog().warn(
              { outputPreview: accumulatedText.slice(0, 200) },
              'codex.structured_output_not_json'
            );
            yield {
              type: 'system',
              content:
                '⚠️ Structured output requested but Codex returned non-JSON text. ' +
                'Downstream $nodeId.output.field references may not evaluate correctly.',
            };
          }
        }

        yield {
          type: 'result',
          sessionId: resolvedThreadId ?? undefined,
          tokens,
          ...(usageBreakdown ? { usageBreakdown } : {}),
          ...(structuredOutput !== undefined ? { structuredOutput } : {}),
        };
        return;
      }
    }

    // Reaching here means the iterator closed without yielding turn.completed
    // or turn.failed (both branches `return` immediately). Common cause: model
    // rejected by the API (model not supported, auth refused) before the turn
    // started. Surface as a fail-stop. The dag-executor's `msg.isError` branch
    // (dag-executor.ts: throws `Node '<id>' failed: SDK returned <subtype>`)
    // turns this into a thrown node failure — distinct from the empty-output
    // guard further down, which returns `{ state: 'failed' }` for AI nodes
    // that streamed nothing but never raised an isError.
    const message = lastNonMcpError ?? 'Codex stream closed without turn.completed or turn.failed';
    getLog().error({ message }, 'stream_incomplete');
    yield {
      type: 'result',
      sessionId: resolvedThreadId ?? undefined,
      isError: true,
      errorSubtype: 'codex_stream_incomplete',
      errors: [message],
    };
  } catch (streamError) {
    // The SDK never produces a clean terminal event on abort — it throws
    // (measured: AbortError, "The operation was aborted.") whether the cause
    // was node-level Cancel or an operator Stop. Reclassify only the Stop
    // case into a marked result so the thread id survives to the
    // dag-executor's resume path; every other throw (including Cancel)
    // propagates unchanged.
    const interrupted = buildInterruptedResult();
    if (interrupted) {
      getLog().info({ threadId: resolvedThreadId }, 'codex.query_interrupted');
      yield interrupted;
      return;
    }
    throw streamError;
  }
}

// ─── Error Classification & Retry ────────────────────────────────────────

/**
 * Classify a Codex error and determine retry eligibility.
 */
function classifyAndEnrichCodexError(
  error: Error,
  model?: string
): { enrichedError: Error; errorClass: string; shouldRetry: boolean } {
  const errorClass = classifyCodexError(error.message);

  if (errorClass === 'model_access') {
    return {
      enrichedError: new Error(buildModelAccessMessage(model)),
      errorClass,
      shouldRetry: false,
    };
  }

  if (errorClass === 'auth') {
    const enrichedError = new Error(`Codex auth error: ${error.message}`);
    enrichedError.cause = error;
    return { enrichedError, errorClass, shouldRetry: false };
  }

  const enrichedError = new Error(`Codex ${errorClass}: ${error.message}`);
  enrichedError.cause = error;
  const shouldRetry = errorClass === 'rate_limit' || errorClass === 'crash';
  return { enrichedError, errorClass, shouldRetry };
}

// ─── Codex Provider ──────────────────────────────────────────────────────

/**
 * Codex AI agent provider.
 * Implements IAgentProvider with Codex SDK integration.
 *
 * sendQuery orchestrates the following internal helpers:
 * - buildThreadOptions: SDK thread configuration
 * - buildTurnOptions: per-turn configuration (output schema, abort signal)
 * - buildEffectivePrompt: systemPrompt delivery via prompt prepend (no SDK channel)
 * - streamCodexEvents: raw SDK event normalization into MessageChunks
 * - classifyAndEnrichCodexError: error classification for retry decisions
 */
export class CodexProvider implements IAgentProvider {
  private readonly retryBaseDelayMs: number;
  private readonly interruptThreadIdWaitMs: number;
  private readonly processTreeOps: ProcessTreeOps;
  private readonly treeReapTerminateGraceMs: number;

  constructor(options?: {
    retryBaseDelayMs?: number;
    interruptThreadIdWaitMs?: number;
    processTreeOps?: ProcessTreeOps;
    treeReapTerminateGraceMs?: number;
  }) {
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
    this.interruptThreadIdWaitMs =
      options?.interruptThreadIdWaitMs ?? CODEX_INTERRUPT_THREAD_ID_WAIT_MS;
    this.processTreeOps = options?.processTreeOps ?? defaultProcessTreeOps;
    this.treeReapTerminateGraceMs =
      options?.treeReapTerminateGraceMs ?? TREE_REAP_TERMINATE_GRACE_MS;
  }

  /**
   * Snapshot the `codex exec` process this attempt spawned, plus its full
   * descendant tree, while a tool call is running — i.e. while `codex exec`
   * is still definitely alive. This CANNOT be done at abort time: measured
   * live, `codex exec`'s death from the SDK's own `spawn({ signal })`
   * teardown is faster than this method's own `ps` round-trip, so a
   * snapshot taken after `attemptController.abort()` always finds the root
   * already a zombie and its children already reparented to init —
   * unrecoverable, not merely late. Called from `streamCodexEvents`'s
   * `command_execution` `item.started` handler (the SDK's own signal that a
   * shell subprocess now exists), and re-armed on every subsequent tool
   * call in the same attempt so a later command's descendants are captured
   * too. Unsupported on Windows (`ps` is unavailable there): skipped
   * silently, same OS signal abort still applies to `codex exec` itself.
   */
  private captureTreeSnapshot(
    cwd: string,
    thread: Thread,
    onCaptured: (snapshot: TreeSnapshot | null) => void
  ): void {
    if (process.platform === 'win32') {
      onCaptured(null);
      return;
    }
    const parentPid = process.pid;
    const knownThreadId = typeof thread.id === 'string' && thread.id.length > 0 ? thread.id : null;
    void (async (): Promise<void> => {
      let processes: Awaited<ReturnType<ProcessTreeOps['listProcesses']>>;
      try {
        processes = await this.processTreeOps.listProcesses();
      } catch (err) {
        getLog().warn({ err }, 'codex.tree_reap_snapshot_failed');
        onCaptured(null);
        return;
      }
      const root = findCodexExecRoot(processes, { parentPid, cwd, threadId: knownThreadId });
      if (root === null) {
        getLog().debug('codex.tree_reap_root_not_found');
        onCaptured(null);
        return;
      }
      if (root === 'ambiguous') {
        getLog().warn('codex.tree_reap_root_ambiguous');
        onCaptured(null);
        return;
      }
      onCaptured({ rootPid: root.pid, descendantPids: collectDescendantPids(processes, root.pid) });
    })().catch((err: unknown) => {
      getLog().warn({ err }, 'codex.tree_reap_snapshot_failed');
      onCaptured(null);
    });
  }

  /**
   * Best-effort: reap every still-alive pid from the last captured
   * snapshot. Armed as a listener side effect at the same points that call
   * `attemptController.abort()` — never dependent on the turn's generator
   * being pulled again, since an external caller (the executor's
   * idle-timeout wrapper) can stop pulling once it observes the abort and
   * never resume it. A missing or empty snapshot (no tool call ever
   * started, or the snapshot failed) is a silent no-op — the OS signal
   * abort already ended `codex exec` itself either way.
   */
  private reapTreeSnapshot(snapshot: TreeSnapshot | null): void {
    if (snapshot === null || snapshot.descendantPids.length === 0) return;
    getLog().info(
      { rootPid: snapshot.rootPid, descendantCount: snapshot.descendantPids.length },
      'codex.tree_reap_armed'
    );
    void reapProcessTree({
      ops: this.processTreeOps,
      descendantPids: snapshot.descendantPids,
      terminateGraceMs: this.treeReapTerminateGraceMs,
    }).catch((err: unknown) => {
      getLog().warn({ err }, 'codex.tree_reap_failed');
    });
  }

  private async createCodexClient(
    configCodexBinaryPath: string | undefined,
    requestEnv?: Record<string, string>,
    codexConfigOverrides?: CodexConfigOverrides
  ): Promise<Codex> {
    if ((!requestEnv || Object.keys(requestEnv).length === 0) && !codexConfigOverrides) {
      return getCodex(configCodexBinaryPath);
    }

    try {
      const codexOptions: CodexOptions = {
        codexPathOverride: await resolveCodexBinaryPath(configCodexBinaryPath),
        ...(requestEnv && Object.keys(requestEnv).length > 0
          ? { env: buildCodexEnv(requestEnv) }
          : {}),
        ...(codexConfigOverrides ? { config: codexConfigOverrides } : {}),
      };
      return new Codex(codexOptions);
    } catch (error) {
      const err = error as Error;
      if (isModelAccessError(err.message)) {
        throw new Error(buildModelAccessMessage());
      }
      throw new Error(`Codex query failed: ${err.message}`);
    }
  }

  getCapabilities(): ProviderCapabilities {
    return CODEX_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    const assistantConfig = requestOptions?.assistantConfig ?? {};
    const codexConfig = parseCodexConfig(assistantConfig);
    const providerWarnings: ProviderWarning[] = [];
    let declaredMcpConfigOverrides: CodexConfigOverrides | undefined;

    if (requestOptions?.nodeConfig?.mcp) {
      const mcpPath = requestOptions.nodeConfig.mcp;
      const { servers, serverNames, missingVars } = await loadMcpConfig(
        mcpPath,
        cwd,
        buildMcpEnvSource(requestOptions.env)
      );
      declaredMcpConfigOverrides = buildCodexMcpConfigOverrides(servers);
      getLog().info({ serverNames, mcpPath }, 'codex.mcp_config_loaded');
      if (missingVars.length > 0) {
        const uniqueVars = [...new Set(missingVars)];
        getLog().warn({ missingVars: uniqueVars }, 'codex.mcp_env_vars_missing');
        providerWarnings.push({
          code: 'mcp_env_vars_missing',
          message: `MCP config references undefined env vars: ${uniqueVars.join(', ')}. These will be empty strings - MCP servers may fail to authenticate.`,
        });
      }
    }

    const suppressWorkflowSkillCatalog = isWorkflowNode(requestOptions);
    const initialConfigOverrides = suppressWorkflowSkillCatalog
      ? withWorkflowSkillCatalogDisabled(declaredMcpConfigOverrides)
      : declaredMcpConfigOverrides;

    for (const warning of providerWarnings) {
      yield { type: 'system', content: `⚠️ ${warning.message}` };
    }

    // 1. Initialize SDK and build thread options
    let codex = await this.createCodexClient(
      codexConfig.codexBinaryPath,
      requestOptions?.env,
      initialConfigOverrides
    );
    const threadOptions = buildThreadOptions(
      cwd,
      requestOptions?.model,
      assistantConfig,
      requestOptions?.nodeConfig
    );
    if (requestOptions?.abortSignal?.aborted) {
      throw new Error('Query aborted');
    }

    // 2. Create or resume thread
    let sessionResumeFailed = false;
    let thread: Thread;
    if (resumeSessionId) {
      getLog().debug({ sessionId: resumeSessionId }, 'resuming_thread');
      try {
        thread = codex.resumeThread(resumeSessionId, threadOptions);
      } catch (error) {
        getLog().error({ err: error, sessionId: resumeSessionId }, 'resume_thread_failed');
        try {
          thread = codex.startThread(threadOptions);
        } catch (startError) {
          const err = startError as Error;
          if (isModelAccessError(err.message)) {
            throw new Error(buildModelAccessMessage(requestOptions?.model));
          }
          throw new Error(`Codex query failed: ${err.message}`);
        }
        sessionResumeFailed = true;
      }
    } else {
      getLog().debug({ cwd }, 'starting_new_thread');
      try {
        thread = codex.startThread(threadOptions);
      } catch (error) {
        const err = error as Error;
        if (isModelAccessError(err.message)) {
          throw new Error(buildModelAccessMessage(requestOptions?.model));
        }
        throw new Error(`Codex query failed: ${err.message}`);
      }
    }

    if (sessionResumeFailed) {
      yield {
        type: 'system',
        content: '⚠️ Could not resume previous session. Starting fresh conversation.',
      };
    }

    // 3. Build turn options and the effective prompt (systemPrompt prepend).
    // Computed once before the retry loop so cold retry attempts, which start
    // fresh threads, also carry the system instructions.
    const { turnOptions, hasOutputFormat } = buildTurnOptions(requestOptions);
    const effectivePrompt = buildEffectivePrompt(prompt, requestOptions);
    let lastError: Error | undefined;
    let skillCatalogCompatibilityFallbackUsed = false;

    for (let attempt = 0; attempt <= MAX_SUBPROCESS_RETRIES; attempt++) {
      if (requestOptions?.abortSignal?.aborted) {
        throw new Error('Query aborted');
      }

      // Fresh AbortController per attempt. Caller's abortSignal, if any, is
      // chained in via a once-listener so cancellation still propagates.
      // Without this, a signal aborted during attempt N (e.g. when the
      // Codex subprocess crashes and Node.js reacts to the `spawn({ signal })`
      // linkage) would wire an already-aborted signal into attempt N+1's
      // `spawn`, SIGTERMing the freshly spawned child before it reads any
      // input. The "Reading prompt from stdin..." in the resulting error is
      // Codex CLI's startup banner, not an indicator of crash location.
      // See issue #1266.
      const attemptController = new AbortController();
      // Captured by `onToolStarted` (passed into `streamCodexEvents` below)
      // the moment a command_execution tool starts — while `codex exec` is
      // still alive, the only window in which its descendant tree can be
      // read at all. Whatever is captured by abort time is what gets
      // reaped; a tool that starts and is aborted within the snapshot's own
      // `ps` round-trip is a documented, bounded gap (see
      // `CodexProvider.captureTreeSnapshot`), not a regression — the prior
      // behavior reaped nothing in every case.
      let treeSnapshot: TreeSnapshot | null = null;
      // Every trigger that ends this attempt goes through here so the tree
      // reap is armed exactly once per attempt, from the same point that
      // decides to abort — never a separate check the generator has to reach.
      // `reapArmedForAttempt` guards the "exactly once": node-level Cancel
      // and operator Stop can both fire for the same attempt (Cancel
      // dominates, per `buildInterruptedResult`), and without this a race
      // between the two would reap twice.
      let reapArmedForAttempt = false;
      const abortAttemptWithReap = (): void => {
        attemptController.abort();
        if (reapArmedForAttempt) return;
        reapArmedForAttempt = true;
        this.reapTreeSnapshot(treeSnapshot);
      };
      const onCallerAbort = (): void => {
        abortAttemptWithReap();
      };
      if (requestOptions?.abortSignal) {
        requestOptions.abortSignal.addEventListener('abort', onCallerAbort, { once: true });
      }

      // Operator Stop (#8.4), mirrored on the same attemptController the SDK
      // already aborts for node-level Cancel. `thread.id` is a live getter the
      // SDK updates as soon as its internal parser reaches `thread.started`
      // (measured: interrupt-resume-spike.ts) — a resumed thread already knows
      // it synchronously. Aborting before the id is known can kill the child
      // before that line is ever parsed, losing the only handle the operator
      // could redirect to, so a fresh-thread Stop defers briefly. The
      // unconditional abort after the wait means Stop can never hang.
      let interruptDeferTimer: ReturnType<typeof setTimeout> | undefined;
      const onOperatorInterrupt = (): void => {
        if (typeof thread.id === 'string' && thread.id.length > 0) {
          abortAttemptWithReap();
          return;
        }
        interruptDeferTimer = setTimeout(() => {
          abortAttemptWithReap();
        }, this.interruptThreadIdWaitMs);
      };
      if (requestOptions?.interruptSignal) {
        if (requestOptions.interruptSignal.aborted) {
          onOperatorInterrupt();
        } else {
          requestOptions.interruptSignal.addEventListener('abort', onOperatorInterrupt, {
            once: true,
          });
        }
      }

      turnOptions.signal = attemptController.signal;

      try {
        if (attempt > 0) {
          getLog().debug({ cwd, attempt }, 'starting_new_thread');
          try {
            thread = codex.startThread(threadOptions);
          } catch (startError) {
            const err = startError as Error;
            if (isModelAccessError(err.message)) {
              getLog().debug({ attempt, errorClass: 'model_access' }, 'query_error_pre_retry');
              throw new Error(buildModelAccessMessage(requestOptions?.model));
            }
            throw new Error(`Codex query failed: ${err.message}`);
          }
        }

        try {
          // 4. Run and consume the streamed turn. Codex starts its subprocess
          // lazily while events are iterated, so compatibility errors must be
          // caught around both runStreamed() and event consumption.
          let providerEventEmitted = false;
          while (true) {
            try {
              const result = await thread.runStreamed(effectivePrompt, turnOptions);
              for await (const chunk of withResumedOutcome(
                streamCodexEvents(
                  result.events as AsyncIterable<Record<string, unknown>>,
                  hasOutputFormat,
                  thread.id,
                  attemptController.signal,
                  requestOptions?.abortSignal,
                  requestOptions?.interruptSignal,
                  cwd,
                  Boolean(requestOptions?.nodeConfig?.mcp),
                  threadOptions.model,
                  undefined,
                  () => {
                    this.captureTreeSnapshot(cwd, thread, snapshot => {
                      treeSnapshot = snapshot;
                    });
                  }
                ),
                // Stamp from the attempt that produced the result: any retry
                // (attempt > 0) re-runs on a fresh startThread (cold), so the prior
                // session context is lost even when the initial resumeThread succeeded.
                resumedOutcome(resumeSessionId, !sessionResumeFailed && attempt === 0)
              )) {
                providerEventEmitted = true;
                yield chunk;
              }
              return;
            } catch (error) {
              const err = error as Error;
              if (
                providerEventEmitted ||
                !suppressWorkflowSkillCatalog ||
                skillCatalogCompatibilityFallbackUsed ||
                !isWorkflowSkillCatalogConfigUnsupported(err.message)
              ) {
                throw error;
              }

              skillCatalogCompatibilityFallbackUsed = true;
              getLog().warn(
                { err, nodeId: requestOptions?.nodeConfig?.nodeId },
                'codex.workflow_skill_catalog_suppression_unsupported'
              );
              yield {
                type: 'system',
                content:
                  '⚠️ This Codex binary does not support suppressing the automatic skill catalog. Continuing with native skill discovery enabled.',
              };

              codex = await this.createCodexClient(
                codexConfig.codexBinaryPath,
                requestOptions?.env,
                declaredMcpConfigOverrides
              );
              if (resumeSessionId) {
                try {
                  thread = codex.resumeThread(resumeSessionId, threadOptions);
                } catch (resumeError) {
                  getLog().error(
                    { err: resumeError, sessionId: resumeSessionId },
                    'resume_thread_failed'
                  );
                  thread = codex.startThread(threadOptions);
                  sessionResumeFailed = true;
                  yield {
                    type: 'system',
                    content: '⚠️ Could not resume previous session. Starting fresh conversation.',
                  };
                }
              } else {
                thread = codex.startThread(threadOptions);
              }
            }
          }
        } catch (error) {
          const err = error as Error;

          if (requestOptions?.abortSignal?.aborted) {
            throw new Error('Query aborted');
          }

          const { enrichedError, errorClass, shouldRetry } = classifyAndEnrichCodexError(
            err,
            requestOptions?.model
          );

          getLog().error(
            { err, errorClass, attempt, maxRetries: MAX_SUBPROCESS_RETRIES },
            'query_error'
          );

          if (!shouldRetry || attempt >= MAX_SUBPROCESS_RETRIES) {
            throw enrichedError;
          }

          const delayMs = this.retryBaseDelayMs * Math.pow(2, attempt);
          getLog().info({ attempt, delayMs, errorClass }, 'retrying_query');
          await new Promise(resolve => setTimeout(resolve, delayMs));
          lastError = enrichedError;
        }
      } finally {
        if (requestOptions?.abortSignal) {
          requestOptions.abortSignal.removeEventListener('abort', onCallerAbort);
        }
        if (requestOptions?.interruptSignal) {
          requestOptions.interruptSignal.removeEventListener('abort', onOperatorInterrupt);
        }
        if (interruptDeferTimer !== undefined) {
          clearTimeout(interruptDeferTimer);
        }
        // The per-attempt AbortController is short-lived and goes out of
        // scope at iteration end — no explicit abort() cleanup needed.
        // Calling abort() here would race with the codex-sdk's own finally
        // (which calls child.removeAllListeners() + child.kill()), firing
        // Node's internal spawn-signal abort listener on a listenerless
        // child and surfacing an uncaught AbortError.  See #1735.
      }
    }

    throw lastError ?? new Error('Codex query failed after retries');
  }

  getType(): string {
    return 'codex';
  }
}
