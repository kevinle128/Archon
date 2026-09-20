import { createLogger } from '@archon/paths';

import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
  SystemPromptInput,
} from '../types';
import { GROK_CAPABILITIES } from './capabilities';
import { resolveGrokBinaryPath } from './binary-resolver';
import { parseGrokConfig, type GrokProviderDefaults } from './config';
import { GrokEventParser } from './event-parser';

const MAX_CAPTURE_CHARS = 1_000_000;
const TERMINATION_GRACE_MS = 5_000;

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  cachedLog ??= createLogger('provider.grok');
  return cachedLog;
}

export interface GrokProcess {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals) => void;
}

export interface GrokSpawnOptions {
  cwd: string;
  env: Record<string, string>;
}

export type GrokSpawner = (command: string[], options: GrokSpawnOptions) => GrokProcess;
export type GrokBinaryResolver = (
  configBinaryPath?: string,
  env?: Record<string, string | undefined>
) => Promise<string>;

interface BuildGrokArgsInput {
  prompt: string;
  cwd: string;
  config: GrokProviderDefaults;
  requestOptions?: SendQueryOptions;
  resumeSessionId?: string;
}

interface BuildGrokArgsResult {
  args: string[];
  model?: string;
  effort?: string;
}

type ProcessOutcome<T> = { ok: true; value: T } | { ok: false; error: Error };

function defaultSpawner(command: string[], options: GrokSpawnOptions): GrokProcess {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited,
    kill: (signal?: NodeJS.Signals): void => {
      proc.kill(signal);
    },
  };
}

function buildProviderEnv(requestEnv?: Record<string, string>): Record<string, string> {
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  return { ...baseEnv, ...(requestEnv ?? {}) };
}

export function buildSpawnCommand(binaryPath: string, args: string[]): string[] {
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(binaryPath)) {
    return ['cmd.exe', '/d', '/s', '/c', binaryPath, ...args];
  }
  return [binaryPath, ...args];
}

function resolveSystemPrompt(
  input: SystemPromptInput | undefined
): { flag: '--system-prompt-override' | '--rules'; value: string } | undefined {
  if (typeof input === 'string') {
    return input.length > 0 ? { flag: '--system-prompt-override', value: input } : undefined;
  }
  if (Array.isArray(input)) {
    const value = input.filter(part => part.length > 0).join('\n\n');
    return value.length > 0 ? { flag: '--system-prompt-override', value } : undefined;
  }
  if (input?.type === 'preset' && typeof input.append === 'string' && input.append.length > 0) {
    return { flag: '--rules', value: input.append };
  }
  return undefined;
}

function pushList(args: string[], flag: string, values: string[] | undefined): void {
  if (values && values.length > 0) args.push(flag, values.join(','));
}

export function buildGrokArgs(input: BuildGrokArgsInput): BuildGrokArgsResult {
  if (input.resumeSessionId && input.requestOptions?.persistSession === false) {
    throw new Error('Grok cannot resume a session when persistSession is false.');
  }

  const args = [
    '--single',
    input.prompt,
    '--verbatim',
    '--cwd',
    input.cwd,
    '--output-format',
    'streaming-json',
    '--permission-mode',
    input.config.permissionMode ?? 'bypassPermissions',
  ];
  const model = input.requestOptions?.model ?? input.config.model;
  if (model) args.push('--model', model);
  const effort = input.requestOptions?.nodeConfig?.effort ?? input.config.modelReasoningEffort;
  if (effort) args.push('--reasoning-effort', effort);

  const systemPrompt = resolveSystemPrompt(
    input.requestOptions?.systemPrompt ?? input.requestOptions?.nodeConfig?.systemPrompt
  );
  if (systemPrompt) args.push(systemPrompt.flag, systemPrompt.value);

  const allowedTools = input.requestOptions?.nodeConfig?.allowed_tools;
  if (allowedTools?.length === 0) {
    throw new Error(
      'Grok CLI treats an empty --tools value as unset, so allowed_tools: [] cannot be enforced.'
    );
  }
  pushList(args, '--tools', allowedTools);
  pushList(args, '--disallowed-tools', input.requestOptions?.nodeConfig?.denied_tools);
  const agents = input.requestOptions?.nodeConfig?.agents;
  if (agents && Object.keys(agents).length > 0) args.push('--agents', JSON.stringify(agents));
  if (input.requestOptions?.outputFormat?.type === 'json_schema') {
    args.push('--json-schema', JSON.stringify(input.requestOptions.outputFormat.schema));
  }
  if (input.resumeSessionId) {
    args.push('--resume', input.resumeSessionId);
    if (input.requestOptions?.forkSession === true) args.push('--fork-session');
  }
  return { args, model, effort };
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (output.length < MAX_CAPTURE_CHARS) {
        output += decoder
          .decode(next.value, { stream: true })
          .slice(0, MAX_CAPTURE_CHARS - output.length);
      }
    }
    return output + decoder.decode().slice(0, MAX_CAPTURE_CHARS - output.length);
  } finally {
    reader.releaseLock();
  }
}

async function* streamLines(stream: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        yield buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.replace(/\r$/, '');
  } finally {
    reader.releaseLock();
  }
}

function scheduleKill(proc: GrokProcess): ReturnType<typeof setTimeout> {
  proc.kill('SIGTERM');
  const timer = setTimeout(() => {
    proc.kill('SIGKILL');
  }, TERMINATION_GRACE_MS);
  return timer;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function exitError(exitCode: number, stderr: string): string {
  const detail = stderr.trim().slice(0, 1000);
  if (/auth|credential|sign.?in|login/i.test(detail)) {
    return `Grok CLI is not authenticated. Run \`grok login\`, then retry.${detail ? ` Grok said: ${detail}` : ''}`;
  }
  return detail
    ? `Grok CLI exited with code ${String(exitCode)}: ${detail}`
    : `Grok CLI exited with code ${String(exitCode)}.`;
}

function transportErrorResult(
  parser: GrokEventParser,
  subtype: 'grok_protocol_error' | 'grok_exit_nonzero' | 'grok_transport_error',
  message: string,
  resumeRequested: boolean
): MessageChunk {
  const observed = parser.buildResult(resumeRequested ? false : undefined);
  return {
    ...observed,
    type: 'result',
    isError: true,
    errorSubtype: subtype,
    errors: [message, ...(observed.errors ?? []).filter(error => error !== message)],
  };
}

function hasAuthoritativeUsage(result: MessageChunk): boolean {
  return (
    result.type === 'result' &&
    Array.isArray(result.usageBreakdown) &&
    result.usageBreakdown.length > 0
  );
}

export class GrokProvider implements IAgentProvider {
  private readonly spawn: GrokSpawner;
  private readonly resolveBinary: GrokBinaryResolver;

  constructor(options?: { spawn?: GrokSpawner; resolveBinary?: GrokBinaryResolver }) {
    this.spawn = options?.spawn ?? defaultSpawner;
    this.resolveBinary = options?.resolveBinary ?? resolveGrokBinaryPath;
  }

  getType(): string {
    return 'grok';
  }

  getCapabilities(): ProviderCapabilities {
    return GROK_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted) throw new Error('Query aborted');
    const config = parseGrokConfig(requestOptions?.assistantConfig ?? {});
    const env = buildProviderEnv(requestOptions?.env);
    const binary = await this.resolveBinary(config.grokBinaryPath, env);
    const { args, model, effort } = buildGrokArgs({
      prompt,
      cwd,
      config,
      requestOptions,
      resumeSessionId,
    });
    const proc = this.spawn(buildSpawnCommand(binary, args), { cwd, env });
    const parser = new GrokEventParser(model);
    const abortSignal = requestOptions?.abortSignal;
    let processExited = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let protocolError: Error | undefined;
    let transportError: Error | undefined;
    const clearKillTimer = (): void => {
      if (killTimer) clearTimeout(killTimer);
      killTimer = undefined;
    };
    const terminate = (): void => {
      if (!processExited && !killTimer) killTimer = scheduleKill(proc);
    };
    const onAbort = (): void => {
      terminate();
    };
    const exitOutcome = proc.exited.then<ProcessOutcome<number>, ProcessOutcome<number>>(
      code => {
        processExited = true;
        clearKillTimer();
        return { ok: true, value: code };
      },
      error => {
        const normalized = toError(error);
        transportError ??= normalized;
        terminate();
        return { ok: false, error: normalized };
      }
    );
    const stderrOutcome = readStream(proc.stderr).then<
      ProcessOutcome<string>,
      ProcessOutcome<string>
    >(
      value => ({ ok: true, value }),
      error => {
        const normalized = toError(error);
        transportError ??= normalized;
        terminate();
        return { ok: false, error: normalized };
      }
    );

    getLog().info(
      {
        cwd,
        model,
        effort,
        resumed: resumeSessionId !== undefined,
        forked: requestOptions?.forkSession === true,
      },
      'grok.query_started'
    );
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      try {
        for await (const line of streamLines(proc.stdout)) {
          if (line.trim().length === 0) continue;
          try {
            for (const chunk of parser.consumeLine(line)) yield chunk;
          } catch (error) {
            protocolError = toError(error);
            terminate();
            break;
          }
        }
      } catch (error) {
        transportError ??= toError(error);
        terminate();
      }

      const [exited, stderr] = await Promise.all([exitOutcome, stderrOutcome]);
      for (const chunk of parser.closeOutstandingTools()) yield chunk;
      if (abortSignal?.aborted) throw new Error('Query aborted');

      // Late I/O after the parser already accepted authoritative usage must
      // yield one terminal isError result (not throw) so the executor can
      // record spend before failing the node. No-usage I/O still throws.
      const lateIoError =
        transportError ??
        (!exited.ok ? exited.error : undefined) ??
        (!stderr.ok ? stderr.error : undefined);
      if (lateIoError) {
        const observed = parser.buildResult(resumeSessionId !== undefined ? false : undefined);
        if (hasAuthoritativeUsage(observed)) {
          const message = lateIoError.message;
          yield { type: 'system', content: message };
          yield transportErrorResult(
            parser,
            'grok_transport_error',
            message,
            resumeSessionId !== undefined
          );
          return;
        }
        throw lateIoError;
      }
      // lateIoError already covered both failure arms; re-check to narrow the union.
      if (!exited.ok) throw exited.error;
      if (!stderr.ok) throw stderr.error;

      if (protocolError) {
        yield { type: 'system', content: protocolError.message };
        yield transportErrorResult(
          parser,
          'grok_protocol_error',
          protocolError.message,
          resumeSessionId !== undefined
        );
        return;
      }
      if (exited.value !== 0) {
        const message = exitError(exited.value, stderr.value);
        yield { type: 'system', content: message };
        yield transportErrorResult(
          parser,
          'grok_exit_nonzero',
          message,
          resumeSessionId !== undefined
        );
        return;
      }
      yield parser.buildResult(resumeSessionId === undefined ? undefined : true);
      getLog().info({ sessionId: parser.getSessionId() }, 'grok.query_completed');
    } finally {
      abortSignal?.removeEventListener('abort', onAbort);
      if (!processExited) terminate();
      await Promise.all([exitOutcome, stderrOutcome]);
      if (processExited) clearKillTimer();
    }
  }
}
