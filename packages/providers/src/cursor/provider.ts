import { createLogger } from '@archon/paths';
import type {
  AgentOptions,
  McpServerConfig,
  SDKAgent,
  SDKCustomTool,
  SDKJsonValue,
  ToolName,
} from '@cursor/sdk';

import type {
  IAgentProvider,
  MessageChunk,
  NativeTool,
  ProviderCapabilities,
  SendQueryOptions,
  SystemPromptInput,
} from '../types';
import { STREAM_ABORTED_TERMINAL_REASON } from '../types';
import { loadMcpConfig } from '../mcp/config';
import { augmentPromptForJsonSchema, tryParseStructuredOutput } from '../shared/structured-output';
import { resumedOutcome, withResumedOutcome } from '../shared/resumed';
import { CURSOR_CAPABILITIES } from './capabilities';
import { readCursorCliLogin } from './cli-login';
import { parseCursorConfig } from './config';
import {
  mapCursorMessage,
  toArchonTokenUsage,
  toCursorUsageBreakdown,
  type CursorEventState,
} from './event-bridge';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('provider.cursor');
  return cachedLog;
}

function systemPromptText(value: SystemPromptInput | undefined): string | undefined {
  if (typeof value === 'string') return value.trim().length > 0 ? value : undefined;
  if (Array.isArray(value)) {
    const joined = value.join('\n\n');
    return joined.trim().length > 0 ? joined : undefined;
  }
  return value?.append?.trim() ? value.append : undefined;
}

function buildEffectivePrompt(prompt: string, options?: SendQueryOptions): string {
  const systemText = systemPromptText(options?.systemPrompt ?? options?.nodeConfig?.systemPrompt);
  let effective = systemText ? `${systemText}\n\n---\n\n${prompt}` : prompt;
  const schema = options?.outputFormat?.schema ?? options?.nodeConfig?.output_format;
  if (schema) effective = augmentPromptForJsonSchema(effective, schema);
  return effective;
}

function toSdkJsonValue(value: unknown, path: string): SDKJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toSdkJsonValue(item, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    const result: Record<string, SDKJsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toSdkJsonValue(item, `${path}.${key}`);
    }
    return result;
  }
  throw new Error(`Cursor native tool schema contains a non-JSON value at ${path}.`);
}

function buildCustomTools(
  nativeTools: readonly NativeTool[] | undefined
): Record<string, SDKCustomTool> {
  const customTools: Record<string, SDKCustomTool> = {};
  for (const tool of nativeTools ?? []) {
    const schema = toSdkJsonValue(tool.inputSchema, `${tool.name}.inputSchema`);
    if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new Error(`Cursor native tool '${tool.name}' inputSchema must be an object.`);
    }
    customTools[tool.name] = {
      description: tool.description,
      inputSchema: schema,
      execute: async (args, context): Promise<string> =>
        tool.handler(args, {
          toolUseId: context.toolCallId,
          sessionId: context.sessionId,
        }),
    };
  }
  return customTools;
}

function stringRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Cursor MCP ${field} must be an object of string values.`);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== 'string') {
      throw new Error(`Cursor MCP ${field}.${key} must be a string.`);
    }
    result[key] = item;
  }
  return result;
}

function toCursorMcpServers(servers: Record<string, unknown>): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {};
  for (const [name, raw] of Object.entries(servers)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Cursor MCP server '${name}' must be an object.`);
    }
    const server = raw as Record<string, unknown>;
    if (typeof server.command === 'string') {
      if (
        server.args !== undefined &&
        (!Array.isArray(server.args) || !server.args.every(arg => typeof arg === 'string'))
      ) {
        throw new Error(`Cursor MCP server '${name}'.args must be an array of strings.`);
      }
      const env = stringRecord(server.env, `${name}.env`);
      result[name] = {
        type: 'stdio',
        command: server.command,
        ...(server.args ? { args: server.args } : {}),
        ...(env ? { env } : {}),
        ...(typeof server.cwd === 'string' ? { cwd: server.cwd } : {}),
      };
      continue;
    }
    if (typeof server.url === 'string') {
      const headers = stringRecord(server.headers, `${name}.headers`);
      result[name] = {
        type: server.type === 'sse' ? 'sse' : 'http',
        url: server.url,
        ...(headers ? { headers } : {}),
      };
      continue;
    }
    throw new Error(`Cursor MCP server '${name}' must declare either command or url.`);
  }
  return result;
}

async function resolveMcpServers(
  options: SendQueryOptions | undefined,
  cwd: string
): Promise<Record<string, McpServerConfig> | undefined> {
  const mcpPath = options?.nodeConfig?.mcp;
  if (!mcpPath) return undefined;
  const loaded = await loadMcpConfig(mcpPath, cwd, {
    ...process.env,
    ...(options?.env ?? {}),
  });
  if (loaded.missingVars.length > 0) {
    getLog().warn(
      { missingVars: loaded.missingVars, serverNames: loaded.serverNames },
      'cursor.mcp_env_vars_missing'
    );
  }
  return toCursorMcpServers(loaded.servers);
}

function resolveModel(options: SendQueryOptions | undefined): string {
  const config = parseCursorConfig(options?.assistantConfig ?? {});
  const model = (options?.model ?? config.model)?.trim();
  if (!model) {
    throw new Error(
      "Cursor requires a model. Set 'model:' on the workflow node or configure assistants.cursor.model."
    );
  }
  return model;
}

function explicitCursorApiKey(options: SendQueryOptions | undefined): string | undefined {
  const fromRequest = options?.env?.CURSOR_API_KEY;
  const raw = fromRequest !== undefined ? fromRequest : process.env.CURSOR_API_KEY;
  if (raw === undefined) return undefined;
  return raw.trim();
}

async function resolveCursorAuth(
  options: SendQueryOptions | undefined
): Promise<{ apiKey: string; teamId?: number }> {
  const explicit = explicitCursorApiKey(options);
  if (explicit !== undefined) {
    if (explicit.length === 0) {
      throw new Error(
        'Cursor requires CURSOR_API_KEY. Set it in the environment or connect a Cursor API key before starting the agent.'
      );
    }
    return { apiKey: explicit };
  }

  const login = await readCursorCliLogin();
  if (login.status === 'present') {
    return login.teamId === undefined
      ? { apiKey: login.bearer }
      : { apiKey: login.bearer, teamId: login.teamId };
  }
  if (login.status === 'locked') {
    throw new Error(
      'Cursor CLI is logged in, but the macOS login keychain is locked for this process. Run Archon in the GUI login session, or set CURSOR_API_KEY.'
    );
  }
  if (login.status === 'expired') {
    throw new Error(
      'The Cursor CLI access token has expired. Run `agent login` again, or set CURSOR_API_KEY.'
    );
  }
  throw new Error(
    'Cursor requires a CLI login or CURSOR_API_KEY. Run `agent login` on this machine, or set CURSOR_API_KEY.'
  );
}

async function createOrResumeAgent(
  resumeSessionId: string | undefined,
  agentOptions: AgentOptions
): Promise<{ agent: SDKAgent; resumed: boolean }> {
  const { Agent: cursorAgent } = await import('@cursor/sdk');
  if (!resumeSessionId) {
    return { agent: await cursorAgent.create(agentOptions), resumed: false };
  }
  try {
    return { agent: await cursorAgent.resume(resumeSessionId, agentOptions), resumed: true };
  } catch (error) {
    getLog().warn(
      {
        sessionId: resumeSessionId,
        error: error instanceof Error ? error.message : String(error),
      },
      'cursor.session_resume_failed'
    );
    return { agent: await cursorAgent.create(agentOptions), resumed: false };
  }
}

async function* streamCursorRun(
  agent: SDKAgent,
  prompt: string,
  options: SendQueryOptions | undefined,
  resolvedModel: string
): AsyncGenerator<MessageChunk> {
  const run = await agent.send(prompt);
  let cancelRequested = false;
  let operatorInterrupted = false;
  let nodeCancelled = false;
  const state: CursorEventState = {};

  // One cancel. A node abort overrides an earlier operator Stop, so only a
  // Stop that stays the sole cause is reported as stream_aborted.
  const cancel = (kind: 'interrupt' | 'abort'): void => {
    if (kind === 'abort') {
      nodeCancelled = true;
      operatorInterrupted = false;
    } else if (!nodeCancelled) {
      operatorInterrupted = true;
    }
    if (cancelRequested) return;
    cancelRequested = true;
    void run.cancel().catch(error => {
      getLog().error(
        {
          runId: run.id,
          error: error instanceof Error ? error.message : String(error),
          err: error,
        },
        'cursor.run_cancel_failed'
      );
    });
  };
  const onInterrupt = (): void => {
    cancel('interrupt');
  };
  const onAbort = (): void => {
    cancel('abort');
  };
  options?.interruptSignal?.addEventListener('abort', onInterrupt, { once: true });
  options?.abortSignal?.addEventListener('abort', onAbort, { once: true });
  if (options?.interruptSignal?.aborted) onInterrupt();
  if (options?.abortSignal?.aborted) onAbort();

  try {
    try {
      for await (const message of run.stream()) {
        // A node abort unwinds without yielding: the consumer may have stopped pulling.
        if (nodeCancelled) break;
        for (const chunk of mapCursorMessage(message, state)) {
          if (nodeCancelled) break;
          yield chunk;
        }
      }
    } catch (error) {
      if (!operatorInterrupted && !nodeCancelled) throw error;
    }
    if (nodeCancelled) throw new Error('Query aborted');

    const result = await run.wait();
    if (nodeCancelled) throw new Error('Query aborted');
    const usage = result.usage ?? state.usage;
    const reportedModel = result.model?.id?.trim() || undefined;
    const tokens = toArchonTokenUsage(usage);
    const usageBreakdown = toCursorUsageBreakdown(usage, reportedModel, resolvedModel);
    const hasOutputSchema = Boolean(
      options?.outputFormat?.schema ?? options?.nodeConfig?.output_format
    );
    const structuredOutput =
      hasOutputSchema && result.result ? tryParseStructuredOutput(result.result) : undefined;
    // Only a run the SDK actually cancelled counts as an operator interrupt; a Stop
    // that races a natural finish or an SDK error keeps that outcome.
    const wasOperatorInterrupted = operatorInterrupted && result.status === 'cancelled';
    const isError =
      result.status === 'error' || (result.status === 'cancelled' && !wasOperatorInterrupted);

    yield {
      type: 'result',
      sessionId: agent.agentId,
      ...(tokens ? { tokens } : {}),
      ...(usageBreakdown ? { usageBreakdown } : {}),
      ...(reportedModel ? { resolvedModel: { id: reportedModel } } : {}),
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
      ...(isError ? { isError: true } : {}),
      ...(result.error?.code ? { errorSubtype: result.error.code } : {}),
      ...(result.error?.message ? { errors: [result.error.message] } : {}),
      ...(wasOperatorInterrupted ? { terminalReason: STREAM_ABORTED_TERMINAL_REASON } : {}),
      stopReason: result.status,
    };
  } finally {
    options?.interruptSignal?.removeEventListener('abort', onInterrupt);
    options?.abortSignal?.removeEventListener('abort', onAbort);
  }
}

export class CursorProvider implements IAgentProvider {
  getCapabilities(): ProviderCapabilities {
    return CURSOR_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    options?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (options?.execContext?.kind === 'container') {
      throw new Error('Cursor provider does not support container execution.');
    }
    if (options?.abortSignal?.aborted) throw new Error('Query aborted');

    const { apiKey, teamId } = await resolveCursorAuth(options);
    const model = resolveModel(options);
    const customTools = buildCustomTools(options?.nativeTools);
    const mcpServers = await resolveMcpServers(options, cwd);
    const nodeConfig = options?.nodeConfig;
    const agentOptions: AgentOptions = {
      model: { id: model },
      // The CLI login's access token is the bearer the CLI sends. The SDK
      // puts `apiKey` in Authorization, so that token is passed here. An
      // explicit CURSOR_API_KEY still wins and is sent the same way.
      apiKey,
      ...(teamId !== undefined ? { teamId } : {}),
      local: {
        cwd,
        // On/off only. Archon's richer sandbox: field is not translated.
        sandboxOptions: { enabled: true },
        ...(Object.keys(customTools).length > 0 ? { customTools } : {}),
      },
      ...(nodeConfig?.allowed_tools !== undefined
        ? { tools: nodeConfig.allowed_tools as ToolName[] }
        : {}),
      ...(nodeConfig?.denied_tools !== undefined
        ? { disallowedTools: nodeConfig.denied_tools as ToolName[] }
        : {}),
      ...(mcpServers ? { mcpServers } : {}),
    };

    const { agent, resumed } = await createOrResumeAgent(resumeSessionId, agentOptions);
    try {
      if (options?.abortSignal?.aborted) throw new Error('Query aborted');
      const stream = streamCursorRun(agent, buildEffectivePrompt(prompt, options), options, model);
      yield* withResumedOutcome(stream, resumedOutcome(resumeSessionId, resumed));
    } finally {
      agent.close();
    }
  }

  getType(): string {
    return 'cursor';
  }
}
