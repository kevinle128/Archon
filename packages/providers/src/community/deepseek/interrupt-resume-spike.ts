/**
 * Diagnostic-only DeepSeek ACP interrupt → close → resume spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * Proves the US-001 substrate against the pinned DSH runtime:
 *   1. Start a tool-using turn
 *   2. Abort interruptSignal after the first observable assistant/tool event
 *   3. Record interruptAckMs through the local abort result
 *   4. Resume the same session id and require a non-error continuation
 *
 * Sanitized output only — no prompts, model text, credentials, base URLs,
 * env contents, or raw tool payloads.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { MessageChunk, SendQueryOptions } from '../../types';
import { DeepseekProvider } from './provider';

const EXPERIMENT_TIMEOUT_MS = 120_000;
const PINNED_DSH = '0.1.2-rc.1';
const PINNED_ACP = '1.4.0';

/** Long enough that the first assistant/tool event arrives before natural end. */
const INTERRUPTIBLE_PROMPT =
  'Use a tool if available. Count slowly from 1 to 200, one number per line, with brief pauses. Do not finish early.';
const CONTINUATION_PROMPT = 'Reply with exactly pong and nothing else.';

type ResultChunk = Extract<MessageChunk, { type: 'result' }>;

type FailureCategory =
  | 'missing-env'
  | 'version-mismatch'
  | 'timeout'
  | 'authentication'
  | 'model'
  | 'protocol'
  | 'missing-session'
  | 'resume'
  | 'continuation'
  | 'runtime-error';

interface InterruptRunEvidence {
  abortResultShapeExact: boolean;
  sessionIdPresent: boolean;
  interruptAckMs: number | null;
  postInterruptChunkTypes: string[];
  postInterruptToolStatuses: string[];
  closeCompleted: boolean;
}

interface SpikeDocument {
  schemaVersion: 1;
  dshVersion: string;
  acpSdkVersion: string;
  interrupt: InterruptRunEvidence | null;
  resume: {
    resumedTrue: boolean;
    sessionIdMatchesInterrupted: boolean;
    nonErrorContinuation: boolean;
  } | null;
  outcome: 'Proceed' | 'Block';
  failureCategory: FailureCategory | null;
  toolMappingDecision: 'unnecessary' | 'apply-operator-interrupt-failed-map' | 'incomplete';
  notes: string[];
}

function envValue(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.length === 0) return undefined;
  return value;
}

function readInstalledVersion(packageName: string, expected: string): string {
  const requireFromHere = createRequire(import.meta.url);
  try {
    const entry = Bun.resolveSync(packageName, import.meta.dir);
    let dir = dirname(entry);
    for (let i = 0; i < 6; i += 1) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          'version' in parsed &&
          typeof (parsed as { version: unknown }).version === 'string' &&
          'name' in parsed &&
          (parsed as { name: unknown }).name === packageName
        ) {
          const version = (parsed as { version: string }).version;
          if (version !== expected) {
            throw new Error(`${packageName} version mismatch: got ${version}, want ${expected}`);
          }
          return version;
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('version mismatch')) throw error;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('version mismatch')) throw error;
  }

  try {
    const pkg = requireFromHere(`${packageName}/package.json`) as { version?: string };
    if (typeof pkg.version === 'string') {
      if (pkg.version !== expected) {
        throw new Error(`${packageName} version mismatch: got ${pkg.version}, want ${expected}`);
      }
      return pkg.version;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('version mismatch')) throw error;
  }

  throw new Error(`${packageName} manifest is unreadable`);
}

async function runWithTimeout<T>(timeoutMs: number, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error('spike total timeout'), { category: 'timeout' as const }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function classifyError(error: unknown): FailureCategory {
  if (
    error !== null &&
    typeof error === 'object' &&
    'category' in error &&
    (error as { category: unknown }).category === 'timeout'
  ) {
    return 'timeout';
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('version mismatch')) return 'version-mismatch';
  if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('401')) {
    return 'authentication';
  }
  if (lower.includes('model')) return 'model';
  if (lower.includes('resume')) return 'resume';
  if (lower.includes('session')) return 'missing-session';
  if (lower.includes('protocol') || lower.includes('acp')) return 'protocol';
  if (lower.includes('continuation')) return 'continuation';
  return 'runtime-error';
}

async function runInterruptTurn(
  provider: DeepseekProvider,
  cwd: string,
  options: SendQueryOptions
): Promise<{ evidence: InterruptRunEvidence; sessionId: string | null }> {
  const interrupt = new AbortController();
  const evidence: InterruptRunEvidence = {
    abortResultShapeExact: false,
    sessionIdPresent: false,
    interruptAckMs: null,
    postInterruptChunkTypes: [],
    postInterruptToolStatuses: [],
    closeCompleted: false,
  };
  let interrupted = false;
  let abortStartedAt: number | null = null;
  let sessionId: string | null = null;

  const stream = provider.sendQuery(INTERRUPTIBLE_PROMPT, cwd, undefined, {
    ...options,
    interruptSignal: interrupt.signal,
  });

  for await (const chunk of stream) {
    if (!interrupted && (chunk.type === 'assistant' || chunk.type === 'tool')) {
      interrupted = true;
      abortStartedAt = Date.now();
      interrupt.abort();
    } else if (interrupted) {
      evidence.postInterruptChunkTypes.push(chunk.type);
      if (chunk.type === 'tool_result') {
        evidence.postInterruptToolStatuses.push(chunk.toolOutcome ?? 'unknown');
      }
    }

    if (chunk.type === 'result') {
      if (typeof chunk.sessionId === 'string' && chunk.sessionId.length > 0) {
        sessionId = chunk.sessionId;
        evidence.sessionIdPresent = true;
      }
      evidence.abortResultShapeExact =
        chunk.stopReason === 'aborted' &&
        chunk.isError === true &&
        chunk.errorSubtype === 'deepseek_aborted' &&
        !('terminalReason' in chunk);
      if (abortStartedAt !== null) {
        evidence.interruptAckMs = Date.now() - abortStartedAt;
      }
      // Local abort result is emitted only after session/close in the driver.
      evidence.closeCompleted = evidence.abortResultShapeExact || chunk.isError === true;
    }
  }

  return { evidence, sessionId };
}

async function runContinuationTurn(
  provider: DeepseekProvider,
  cwd: string,
  sessionId: string,
  options: SendQueryOptions
): Promise<{
  resumedTrue: boolean;
  sessionIdMatchesInterrupted: boolean;
  nonErrorContinuation: boolean;
}> {
  let result: ResultChunk | undefined;
  for await (const chunk of provider.sendQuery(CONTINUATION_PROMPT, cwd, sessionId, options)) {
    if (chunk.type === 'result') result = chunk;
  }
  if (result === undefined) {
    throw Object.assign(new Error('continuation missing result'), { category: 'continuation' });
  }
  return {
    resumedTrue: result.resumed === true,
    sessionIdMatchesInterrupted: result.sessionId === sessionId,
    nonErrorContinuation: result.isError !== true,
  };
}

function decideOutcome(document: SpikeDocument): 'Proceed' | 'Block' {
  const interrupt = document.interrupt;
  const resume = document.resume;
  if (interrupt === null || resume === null) return 'Block';
  if (document.failureCategory !== null) return 'Block';
  if (interrupt.interruptAckMs === null || interrupt.interruptAckMs >= 1000) return 'Block';
  if (
    !interrupt.abortResultShapeExact ||
    !interrupt.sessionIdPresent ||
    !interrupt.closeCompleted
  ) {
    return 'Block';
  }
  if (!resume.resumedTrue || !resume.sessionIdMatchesInterrupted || !resume.nonErrorContinuation) {
    return 'Block';
  }
  return 'Proceed';
}

function decideToolMapping(
  evidence: InterruptRunEvidence | null
): SpikeDocument['toolMappingDecision'] {
  if (evidence === null) return 'incomplete';
  // Live cancelled in-flight tools arriving as ACP failed would push 'error' outcomes
  // after interrupt. Executor already settles still-open tools as interrupted.
  if (evidence.postInterruptToolStatuses.includes('error')) {
    return 'apply-operator-interrupt-failed-map';
  }
  return 'unnecessary';
}

async function runLiveSpike(dshVersion: string, acpSdkVersion: string): Promise<SpikeDocument> {
  const apiKey = envValue('DEEPSEEK_API_KEY');
  const baseUrl = envValue('DEEPSEEK_BASE_URL');
  const model = envValue('DEEPSEEK_LIVE_MODEL');

  const document: SpikeDocument = {
    schemaVersion: 1,
    dshVersion,
    acpSdkVersion,
    interrupt: null,
    resume: null,
    outcome: 'Block',
    failureCategory: null,
    toolMappingDecision: 'incomplete',
    notes: [],
  };

  if (apiKey === undefined || baseUrl === undefined || model === undefined) {
    document.failureCategory = 'missing-env';
    document.notes.push(
      'Requires DEEPSEEK_LIVE_TEST=1, DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_LIVE_MODEL.'
    );
    return document;
  }

  const cwd = await mkdtemp(join(tmpdir(), 'archon-deepseek-interrupt-spike-'));
  try {
    await runWithTimeout(EXPERIMENT_TIMEOUT_MS, async () => {
      const provider = new DeepseekProvider();
      const options: SendQueryOptions = {
        model,
        env: {
          DEEPSEEK_API_KEY: apiKey,
          DEEPSEEK_BASE_URL: baseUrl,
        },
        assistantConfig: {
          baseUrl,
          model,
        },
      };

      const { evidence, sessionId } = await runInterruptTurn(provider, cwd, options);
      document.interrupt = evidence;
      document.toolMappingDecision = decideToolMapping(evidence);

      if (!evidence.sessionIdPresent || sessionId === null) {
        throw Object.assign(new Error('interrupted turn missing session id'), {
          category: 'missing-session',
        });
      }
      if (!evidence.abortResultShapeExact) {
        throw Object.assign(new Error('interrupted turn missing exact abort result'), {
          category: 'protocol',
        });
      }

      document.resume = await runContinuationTurn(provider, cwd, sessionId, options);
      if (!document.resume.resumedTrue) {
        throw Object.assign(new Error('resume did not report resumed:true'), {
          category: 'resume',
        });
      }
      if (!document.resume.nonErrorContinuation) {
        throw Object.assign(new Error('continuation failed'), { category: 'continuation' });
      }
    });
  } catch (error) {
    document.failureCategory = classifyError(error);
    document.notes.push('live spike failed; see failureCategory (no secrets logged)');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }

  document.outcome = decideOutcome(document);
  if (document.toolMappingDecision === 'incomplete' && document.interrupt !== null) {
    document.toolMappingDecision = decideToolMapping(document.interrupt);
  }
  return document;
}

async function main(): Promise<void> {
  if (envValue('DEEPSEEK_LIVE_TEST') !== '1') {
    const skipped: SpikeDocument = {
      schemaVersion: 1,
      dshVersion: PINNED_DSH,
      acpSdkVersion: PINNED_ACP,
      interrupt: null,
      resume: null,
      outcome: 'Block',
      failureCategory: 'missing-env',
      toolMappingDecision: 'incomplete',
      notes: ['Skipped: set DEEPSEEK_LIVE_TEST=1 to run the live spike.'],
    };
    process.stdout.write(`${JSON.stringify(skipped)}\n`);
    process.exitCode = 1;
    return;
  }

  let dshVersion: string;
  let acpSdkVersion: string;
  try {
    dshVersion = readInstalledVersion('@deepseek-ai/dsh', PINNED_DSH);
    acpSdkVersion = readInstalledVersion('@agentclientprotocol/sdk', PINNED_ACP);
  } catch (error) {
    const failed: SpikeDocument = {
      schemaVersion: 1,
      dshVersion: PINNED_DSH,
      acpSdkVersion: PINNED_ACP,
      interrupt: null,
      resume: null,
      outcome: 'Block',
      failureCategory: 'version-mismatch',
      toolMappingDecision: 'incomplete',
      notes: [error instanceof Error ? error.message : 'version check failed'],
    };
    process.stdout.write(`${JSON.stringify(failed)}\n`);
    process.exitCode = 1;
    return;
  }

  const document = await runLiveSpike(dshVersion, acpSdkVersion);
  process.stdout.write(`${JSON.stringify(document)}\n`);
  if (document.outcome !== 'Proceed') process.exitCode = 1;
}

await main();
