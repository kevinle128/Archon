import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
} from '../../types';
import { loadMcpConfig } from '../../mcp/config';
import { resumedOutcome, withResumedOutcome } from '../../shared/resumed';
import type { DeepseekProcessInput } from './acp-client';
import { DEEPSEEK_CAPABILITIES } from './capabilities';
import {
  DEFAULT_DEEPSEEK_PERMISSION_MODE,
  DEFAULT_DEEPSEEK_PROFILE,
  DEFAULT_DEEPSEEK_PROVIDER_ROUTE,
  parseDeepseekConfig,
  resolveDeepseekEffort,
} from './config';
import { buildDeepseekChildEnv } from './env';
import {
  collectDeepseekSecretValues,
  DeepseekProviderError,
  isDeepseekSecretName,
  isRedactableSecretValue,
  toDeepseekErrorResult,
} from './errors';
import { buildDeepseekMcpServers } from './mcp';
import { resolveBundledDshEntrypoint, resolveDeepseekNodeBinary } from './node-resolver';

export type DeepseekTurnRunner = (input: DeepseekProcessInput) => AsyncGenerator<MessageChunk>;

export interface DeepseekProviderDependencies {
  runTurn?: DeepseekTurnRunner;
  resolveNodeBinary?: typeof resolveDeepseekNodeBinary;
  resolveDshEntrypoint?: typeof resolveBundledDshEntrypoint;
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names)];
}

function mergeQueryEnv(
  requestEnv: Record<string, string> | undefined
): Record<string, string | undefined> {
  return { ...process.env, ...requestEnv };
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function asDeepseekMcpConfigError(error: unknown): DeepseekProviderError {
  if (error instanceof DeepseekProviderError && error.subtype === 'deepseek_mcp_config_error') {
    return error;
  }
  return new DeepseekProviderError('deepseek_mcp_config_error', messageFromError(error), {
    cause: error,
  });
}

/**
 * Append candidate secret values, applying the one shared policy: the length
 * floor and de-duplication. Callers pass name-matched values; the floor lives
 * here so it cannot diverge between env and MCP sources.
 */
function addSecretValues(secrets: string[], values: readonly string[]): void {
  for (const value of values) {
    if (isRedactableSecretValue(value) && !secrets.includes(value)) {
      secrets.push(value);
    }
  }
}

/**
 * Name-matched secret values declared on MCP servers. These carry header and
 * per-server env values that never enter the child environment, so `env`-derived
 * redaction would miss them. Length filtering and dedup happen in
 * `addSecretValues`.
 */
function mcpSecretValues(servers: DeepseekProcessInput['mcpServers']): string[] {
  const values: string[] = [];
  for (const server of servers) {
    if ('headers' in server) {
      for (const header of server.headers) {
        if (isDeepseekSecretName(header.name)) values.push(header.value);
      }
    }
    if ('env' in server) {
      for (const entry of server.env) {
        if (isDeepseekSecretName(entry.name)) values.push(entry.value);
      }
    }
  }
  return values;
}

function requireModelForCustomRoute(
  config: { providerRoute?: string },
  model: string | undefined
): void {
  if (model !== undefined || config.providerRoute === DEFAULT_DEEPSEEK_PROVIDER_ROUTE) return;
  throw new DeepseekProviderError(
    'deepseek_unsupported_config',
    'assistants.deepseek.providerRoute requires a model from assistants.deepseek.model or the request model because DSH model routing is sent as [providerRoute, model].'
  );
}

function resolveModelSelection(
  providerRoute: string | undefined,
  model: string | undefined
): { providerRoute: string; model?: string } {
  const fallbackRoute = providerRoute ?? DEFAULT_DEEPSEEK_PROVIDER_ROUTE;
  if (model === undefined) return { providerRoute: fallbackRoute };
  const separator = model.indexOf('/');
  if (separator <= 0 || separator === model.length - 1) {
    return { providerRoute: fallbackRoute, model };
  }
  return {
    providerRoute: model.slice(0, separator),
    model: model.slice(separator + 1),
  };
}

/**
 * DeepSeek Harness community provider. Preflight and error-as-result live here;
 * ACP SDK values load only when `sendQuery()` dynamically imports `./acp-client`.
 */
export class DeepseekProvider implements IAgentProvider {
  constructor(private readonly dependencies: DeepseekProviderDependencies = {}) {}

  getType(): string {
    return 'deepseek';
  }

  getCapabilities(): ProviderCapabilities {
    return DEEPSEEK_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted === true) {
      yield toDeepseekErrorResult(
        new DeepseekProviderError('deepseek_aborted', 'DeepSeek turn aborted before start.'),
        []
      );
      return;
    }

    const secrets: string[] = [];
    try {
      const config = parseDeepseekConfig(requestOptions?.assistantConfig ?? {});
      const requestedModel = requestOptions?.model ?? config.model;
      requireModelForCustomRoute(config, requestedModel);
      const selection = resolveModelSelection(config.providerRoute, requestedModel);

      const childEnv = buildDeepseekChildEnv({
        ambient: process.env,
        request: requestOptions?.env,
        baseUrl: config.baseUrl,
        permissionMode: config.permissionMode ?? DEFAULT_DEEPSEEK_PERMISSION_MODE,
      });
      addSecretValues(secrets, collectDeepseekSecretValues(childEnv));

      const resolveNodeBinary = this.dependencies.resolveNodeBinary ?? resolveDeepseekNodeBinary;
      const resolveDshEntrypoint =
        this.dependencies.resolveDshEntrypoint ?? resolveBundledDshEntrypoint;
      const nodeBin = resolveNodeBinary(config.nodeBin, childEnv);
      const dshEntrypoint = resolveDshEntrypoint();

      const warnings: string[] = [];
      let mcpServers = buildDeepseekMcpServers({}, childEnv);
      const mcpPath = requestOptions?.nodeConfig?.mcp;
      if (typeof mcpPath === 'string' && mcpPath.length > 0) {
        try {
          const loaded = await loadMcpConfig(mcpPath, cwd, mergeQueryEnv(requestOptions?.env));
          const missingVars = uniqueNames(loaded.missingVars);
          if (missingVars.length > 0) {
            warnings.push(
              `DeepSeek MCP config references undefined env vars: ${missingVars.join(', ')}. Servers using them may fail at runtime.`
            );
          }
          mcpServers = buildDeepseekMcpServers(loaded.servers, childEnv);
          addSecretValues(secrets, mcpSecretValues(mcpServers));
        } catch (error: unknown) {
          throw asDeepseekMcpConfigError(error);
        }
      }

      const effort = resolveDeepseekEffort(requestOptions?.nodeConfig?.effort ?? config.effort);
      const outputSchema = requestOptions?.outputFormat?.schema;
      const runTurn =
        this.dependencies.runTurn ?? (await import('./acp-client')).runDeepseekAcpTurn;

      for (const warning of warnings) {
        yield { type: 'system', content: warning };
      }

      const input: DeepseekProcessInput = {
        cwd,
        prompt,
        resumeSessionId,
        model: selection.model,
        providerRoute: selection.providerRoute,
        effort,
        mcpServers,
        outputSchema,
        abortSignal: requestOptions?.abortSignal,
        interruptSignal: requestOptions?.interruptSignal,
        nodeBin,
        dshEntrypoint,
        profile: config.profile ?? DEFAULT_DEEPSEEK_PROFILE,
        env: childEnv,
        secretValues: secrets,
      };

      yield* withResumedOutcome(runTurn(input), resumedOutcome(resumeSessionId, true));
    } catch (error: unknown) {
      yield toDeepseekErrorResult(error, secrets);
    }
  }
}
