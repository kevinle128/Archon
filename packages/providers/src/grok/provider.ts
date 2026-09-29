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
// Type-only: unlike DeepSeek/Devin (dynamically imported community providers),
// Grok is built-in and `registry.ts` imports this module statically, so a
// runtime `import` of `./acp-client` here would eagerly evaluate
// `@agentclientprotocol/sdk` on every Archon boot even when Grok never runs.
// The real function is loaded lazily inside `acpQuery()` instead.
import type { GrokAcpProcessInput, runGrokAcpTurn } from './acp-client';
import {
  defaultProcessTreeOps,
  collectDescendantPids,
  reapProcessTree,
  type ProcessTreeOps,
} from '../shared/process-tree-reap';

const MAX_CAPTURE_CHARS = 1_000_000;
const TERMINATION_GRACE_MS = 5_000;

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  cachedLog ??= createLogger('provider.grok');
  return cachedLog;
}

export interface GrokProcess {
  /** The spawned process's own pid — the root to snapshot the descendant tree from on abort. */
  pid: number;
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
    pid: proc.pid,
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

export type GrokTransportSelection =
  | { readonly kind: 'acp' }
  | { readonly kind: 'single'; readonly reason: string };

interface SelectGrokTransportInput {
  config: GrokProviderDefaults;
  requestOptions?: SendQueryOptions;
}

/**
 * Choose which Grok transport a request must use. ACP (`grok agent stdio`)
 * is the default — it is the only transport that can honor Stop
 * (`interruptSignal`) — and `--single` is the fallback for the node configs
 * this migration could not verify an ACP equivalent for. Each reason is a
 * specific empirical or CLI-surface finding, not a guess:
 *
 * - `output_format` (`--json-schema`): no ACP literal exists anywhere in the
 *   binary's own string table.
 * - `nodeConfig.agents` (`--agents`): the `_meta.agentProfile` JSON-object
 *   schema (matched against the binary's own agent-definition field list)
 *   has no field for inline sub-agent definitions.
 * - `allowed_tools`/`denied_tools` (`--tools`/`--disallowed-tools`): tried
 *   twice live via `_meta.agentProfile.{tools,disallowedTools}` on
 *   `session/new` (with and without the schema's required `name` field) —
 *   the model still ran a disallowed tool both times.
 * - `systemPrompt` (`--system-prompt-override`/`--rules`): tried live via a
 *   top-level `_meta.systemPromptOverride` on `session/new` — the model
 *   ignored it and answered the prompt normally.
 * - `forkSession` (`--fork-session`): the agent's `initialize` response never
 *   advertises a session fork capability.
 * - a non-default `permissionMode`: `grok agent`'s own CLI surface (distinct
 *   from the top-level `grok --single` parser) exposes only
 *   `--always-approve`, no `--permission-mode` flag at all.
 *
 * A request routed to `--single` for one of these reasons loses Stop for
 * THIS turn only. `capabilities.interrupt` stays a provider-wide flag and
 * cannot vary per turn, so `sendQuery()` instead emits a typed
 * `turn_not_interruptible` chunk naming the reason before any other chunk of
 * the turn — the dag-executor withholds Stop for that one turn only; a later
 * turn on the same node (e.g. a config that qualifies for ACP) is
 * interruptible again. A human-readable `system` chunk follows for the
 * operator's transcript, never as the signal itself.
 */
export function selectGrokTransport(input: SelectGrokTransportInput): GrokTransportSelection {
  const { config, requestOptions } = input;
  if (requestOptions?.outputFormat?.type === 'json_schema') {
    return {
      kind: 'single',
      reason: 'structured output (--json-schema) has no ACP equivalent on grok agent stdio',
    };
  }
  const agents = requestOptions?.nodeConfig?.agents;
  if (agents && Object.keys(agents).length > 0) {
    return {
      kind: 'single',
      reason: 'inline sub-agent definitions (--agents) have no ACP equivalent on grok agent stdio',
    };
  }
  // Any allowed_tools (including an empty array) is a real restriction
  // intent, so it always falls back — that lets buildGrokArgs's own "empty
  // allowed_tools cannot be enforced" guard still fire on the single path.
  // An empty denied_tools is already a no-op on `--single` too, so it alone
  // does not force a fallback.
  const allowedTools = requestOptions?.nodeConfig?.allowed_tools;
  const deniedTools = requestOptions?.nodeConfig?.denied_tools;
  if (allowedTools !== undefined || (deniedTools !== undefined && deniedTools.length > 0)) {
    return {
      kind: 'single',
      reason:
        'tool restrictions (--tools/--disallowed-tools) did not enforce over the ACP agent profile in live verification',
    };
  }
  if (
    resolveSystemPrompt(
      requestOptions?.systemPrompt ?? requestOptions?.nodeConfig?.systemPrompt
    ) !== undefined
  ) {
    return {
      kind: 'single',
      reason:
        'system prompt override (--system-prompt-override/--rules) had no observed effect over ACP in live verification',
    };
  }
  if (requestOptions?.forkSession === true) {
    return {
      kind: 'single',
      reason: 'session fork (--fork-session) is not advertised by the Grok ACP agent',
    };
  }
  const permissionMode = config.permissionMode;
  if (permissionMode !== undefined && permissionMode !== 'bypassPermissions') {
    return {
      kind: 'single',
      reason: `permission mode '${permissionMode}' has no ACP flag equivalent (grok agent only supports --always-approve)`,
    };
  }
  return { kind: 'acp' };
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

export type GrokAcpTurnRunner = typeof runGrokAcpTurn;

export class GrokProvider implements IAgentProvider {
  private readonly spawn: GrokSpawner;
  private readonly resolveBinary: GrokBinaryResolver;
  private readonly runAcpTurn: GrokAcpTurnRunner | undefined;
  private readonly processTreeOps: ProcessTreeOps;
  private readonly treeReapTerminateGraceMs: number;

  constructor(options?: {
    spawn?: GrokSpawner;
    resolveBinary?: GrokBinaryResolver;
    runAcpTurn?: GrokAcpTurnRunner;
    processTreeOps?: ProcessTreeOps;
    treeReapTerminateGraceMs?: number;
  }) {
    this.spawn = options?.spawn ?? defaultSpawner;
    this.resolveBinary = options?.resolveBinary ?? resolveGrokBinaryPath;
    // Left undefined by default — see the import-site comment above: loaded
    // lazily in acpQuery() so registering Grok never evaluates the ACP SDK.
    this.runAcpTurn = options?.runAcpTurn;
    this.processTreeOps = options?.processTreeOps ?? defaultProcessTreeOps;
    this.treeReapTerminateGraceMs = options?.treeReapTerminateGraceMs ?? TERMINATION_GRACE_MS;
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
    if (resumeSessionId && requestOptions?.persistSession === false) {
      throw new Error('Grok cannot resume a session when persistSession is false.');
    }
    const config = parseGrokConfig(requestOptions?.assistantConfig ?? {});
    const selection = selectGrokTransport({ config, requestOptions });
    if (selection.kind === 'single') {
      // The typed signal (consumed by the dag-executor to withhold Stop for
      // THIS turn) comes first; the prose notice below is for the operator's
      // transcript only and is never itself the signal.
      yield { type: 'turn_not_interruptible', reason: selection.reason };
      yield {
        type: 'system',
        content: `⚠️ Grok is running this turn on the legacy --single transport (${selection.reason}); Stop is not available for this turn. It will run to completion.`,
      };
      yield* this.singleQuery(prompt, cwd, resumeSessionId, requestOptions, config);
      return;
    }
    yield* this.acpQuery(prompt, cwd, resumeSessionId, requestOptions, config);
  }

  private async *acpQuery(
    prompt: string,
    cwd: string,
    resumeSessionId: string | undefined,
    requestOptions: SendQueryOptions | undefined,
    config: GrokProviderDefaults
  ): AsyncGenerator<MessageChunk> {
    const env = buildProviderEnv(requestOptions?.env);
    const binaryPath = await this.resolveBinary(config.grokBinaryPath, env);
    const model = requestOptions?.model ?? config.model;
    const effort = requestOptions?.nodeConfig?.effort ?? config.modelReasoningEffort;
    const input: GrokAcpProcessInput = {
      binaryPath,
      cwd,
      prompt,
      resumeSessionId,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      abortSignal: requestOptions?.abortSignal,
      interruptSignal: requestOptions?.interruptSignal,
    };
    getLog().info(
      { cwd, model, effort, resumed: resumeSessionId !== undefined },
      'grok.acp_query_started'
    );
    const runTurn = this.runAcpTurn ?? (await import('./acp-client')).runGrokAcpTurn;
    for await (const chunk of runTurn(input)) {
      if (chunk.type === 'result') {
        getLog().info({ sessionId: chunk.sessionId }, 'grok.acp_query_completed');
      }
      yield chunk;
    }
  }

  private async *singleQuery(
    prompt: string,
    cwd: string,
    resumeSessionId: string | undefined,
    requestOptions: SendQueryOptions | undefined,
    config: GrokProviderDefaults
  ): AsyncGenerator<MessageChunk> {
    // Re-checked here (not just once at the top of sendQuery): the fallback
    // notice this method's caller yields first is itself an await point, so
    // an abort racing exactly that gap would otherwise be missed — this
    // generator's own `abortSignal.addEventListener('abort', ...)` below
    // only fires on a FUTURE abort, not one already true when attached.
    if (requestOptions?.abortSignal?.aborted) throw new Error('Query aborted');
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
    // Set the moment a `tool` chunk is parsed — the CLI's own signal that it
    // just invoked a tool, which (for a shell-style tool) forks a subprocess
    // this provider does not otherwise have a handle on. Reaping is skipped
    // entirely when no tool ever ran: nothing to reap, and it spares every
    // ordinary abort (Stop/Cancel with no open tool) a `ps` round-trip.
    let toolEverStarted = false;
    // Guards the tree-reap dance to exactly once per query: `terminate()` can
    // be invoked from several racing paths (operator abort, an IO error on
    // either the exit or stderr outcome, a protocol error) and only the first
    // should snapshot-and-kill.
    let reapArmed = false;
    const clearKillTimer = (): void => {
      if (killTimer) clearTimeout(killTimer);
      killTimer = undefined;
    };
    // Reap the tool's own subprocess tree BEFORE signaling the root: unlike
    // Codex (whose SDK races its own abort teardown ahead of any snapshot
    // this provider could take), Archon spawned `proc` itself and decides
    // exactly when to signal it — so the descendant snapshot can be taken
    // first, while `proc` (and anything it forked) is still provably alive,
    // then the root is killed. The snapshot's own `ps` round-trip (~tens of
    // ms) delays the root's SIGTERM by the same amount; every other
    // provider's own reap already costs more than that.
    const terminateWithTreeReap = async (): Promise<void> => {
      if (!toolEverStarted || process.platform === 'win32') {
        if (!processExited) killTimer = scheduleKill(proc);
        return;
      }
      let descendantPids: readonly number[] = [];
      try {
        const processes = await this.processTreeOps.listProcesses();
        descendantPids = collectDescendantPids(processes, proc.pid);
      } catch (err) {
        getLog().warn({ err }, 'grok.tree_reap_snapshot_failed');
      }
      // The process may have exited on its own while the snapshot was in
      // flight — nothing left to signal.
      if (processExited) return;
      killTimer = scheduleKill(proc);
      if (descendantPids.length === 0) return;
      getLog().info(
        { rootPid: proc.pid, descendantCount: descendantPids.length },
        'grok.tree_reap_armed'
      );
      void reapProcessTree({
        ops: this.processTreeOps,
        descendantPids,
        terminateGraceMs: this.treeReapTerminateGraceMs,
      }).catch((err: unknown) => {
        getLog().warn({ err }, 'grok.tree_reap_failed');
      });
    };
    const terminate = (): void => {
      if (processExited || reapArmed) return;
      reapArmed = true;
      void terminateWithTreeReap();
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
            for (const chunk of parser.consumeLine(line)) {
              // The CLI's own signal that it just invoked a tool — for a
              // shell-style tool this forks a subprocess `proc` has no
              // other handle on (see `toolEverStarted` above `terminate`).
              if (chunk.type === 'tool') toolEverStarted = true;
              yield chunk;
            }
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
