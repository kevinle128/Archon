/**
 * Diagnostic-only Grok ACP handshake spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * The shipped Grok adapter uses `--single` (one-shot argv prompt, no stdin
 * channel) — it cannot Stop or soft-inject at all today. Grok's own docs and
 * embedded strings describe a real ACP server (`grok agent stdio`) with an
 * `x.ai/interject` extension method for mid-turn steering, but it is
 * undocumented in any PUBLIC integration example and was flagged as an open
 * question: is `x.ai/interject` reachable from an arbitrary ACP client, or
 * gated to grok's own pager UI? This spike answers that with one live
 * handshake: `initialize` -> `session/new` -> `session/prompt`, then attempt
 * `x.ai/interject` mid-stream and record whether the response is a genuine
 * result or a protocol-level rejection (e.g. method-not-found).
 *
 * Output is a single sanitized JSON evidence document on stdout: event
 * TYPES, JSON-RPC error codes, and boolean facts only — no prompt text, no
 * model output, no credentials.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveGrokBinaryPath } from './binary-resolver';

const EXPERIMENT_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 15_000;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Line-delimited JSON-RPC reader over the ACP child's stdout. */
class JsonRpcReader {
  private buffer = '';
  private readonly pending: JsonRpcMessage[] = [];
  private waiters: ((msg: JsonRpcMessage) => void)[] = [];

  feed(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > 0) {
        try {
          this.deliver(JSON.parse(line) as JsonRpcMessage);
        } catch {
          // Malformed line — skip; not a protocol conformance concern here.
        }
      }
      index = this.buffer.indexOf('\n');
    }
  }

  private deliver(msg: JsonRpcMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(msg);
    else this.pending.push(msg);
  }

  async next(timeoutMs: number): Promise<JsonRpcMessage> {
    const queued = this.pending.shift();
    if (queued !== undefined) return queued;
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== onMsg);
        reject(new Error('JSON-RPC message read timed out'));
      }, timeoutMs);
      const onMsg = (msg: JsonRpcMessage): void => {
        clearTimeout(timer);
        resolve(msg);
      };
      this.waiters.push(onMsg);
    });
  }
}

export interface AcpHandshakeEvidence {
  grokVersion: string;
  initializeSucceeded: boolean;
  sessionNewSucceeded: boolean;
  sessionId: string | null;
  promptAckSeen: boolean;
  /** A `session/update` notification arrived before the interject attempt. */
  sawSessionUpdateBeforeInterject: boolean;
  interjectAttempted: boolean;
  /** The interject response was a genuine JSON-RPC result, not an error. */
  interjectSucceeded: boolean;
  /** JSON-RPC error code if the interject was rejected (e.g. -32601 method not found). */
  interjectErrorCode: number | null;
  interjectErrorMessage: string | null;
  /**
   * Fallback attempt using the `_x.ai/...` (underscore-prefixed) namespace
   * observed on every OTHER server-emitted `x.ai` notification in this
   * session — tests whether `x.ai/interject`'s method-not-found is a naming
   * mismatch rather than genuine unreachability.
   */
  underscoredInterjectAttempted: boolean;
  underscoredInterjectSucceeded: boolean;
  underscoredInterjectErrorCode: number | null;
  underscoredInterjectErrorMessage: string | null;
  observedNotificationMethods: string[];
  failure: string | null;
}

function emptyEvidence(grokVersion: string): AcpHandshakeEvidence {
  return {
    grokVersion,
    initializeSucceeded: false,
    sessionNewSucceeded: false,
    sessionId: null,
    promptAckSeen: false,
    sawSessionUpdateBeforeInterject: false,
    interjectAttempted: false,
    interjectSucceeded: false,
    interjectErrorCode: null,
    interjectErrorMessage: null,
    underscoredInterjectAttempted: false,
    underscoredInterjectSucceeded: false,
    underscoredInterjectErrorCode: null,
    underscoredInterjectErrorMessage: null,
    observedNotificationMethods: [],
    failure: null,
  };
}

async function runHandshakeSpike(grokVersion: string): Promise<AcpHandshakeEvidence> {
  const evidence = emptyEvidence(grokVersion);
  const binaryPath = await resolveGrokBinaryPath();
  const cwd = mkdtempSync(join(tmpdir(), 'archon-grok-acp-spike-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd });
  } catch {
    // A plain directory still satisfies the child's cwd requirement.
  }

  let nextId = 1;
  const proc = Bun.spawn([binaryPath, 'agent', '--always-approve', 'stdio'], {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const reader = new JsonRpcReader();
  void (async (): Promise<void> => {
    if (!proc.stdout) return;
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      reader.feed(decoder.decode(chunk));
    }
  })();
  const send = (method: string, params: unknown): number => {
    const id = nextId++;
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    proc.stdin.flush();
    return id;
  };
  /** Drains notifications (no `id`) until the response matching `id` arrives. */
  const awaitResponse = async (id: number, timeoutMs: number): Promise<JsonRpcMessage> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`awaitResponse(${String(id)}) timed out`);
      const msg = await reader.next(remaining);
      if (msg.id === id) return msg;
      if (msg.method !== undefined) {
        evidence.observedNotificationMethods.push(msg.method);
        if (msg.method === 'session/update') evidence.sawSessionUpdateBeforeInterject = true;
      }
    }
  };

  try {
    const initId = send('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });
    const initResponse = await awaitResponse(initId, READY_TIMEOUT_MS);
    evidence.initializeSucceeded = initResponse.error === undefined;

    if (evidence.initializeSucceeded) {
      const sessionId2 = send('session/new', { cwd, mcpServers: [], _meta: { yoloMode: true } });
      const sessionResponse = await awaitResponse(sessionId2, READY_TIMEOUT_MS);
      evidence.sessionNewSucceeded = sessionResponse.error === undefined;
      const result = sessionResponse.result as { sessionId?: string } | undefined;
      evidence.sessionId = typeof result?.sessionId === 'string' ? result.sessionId : null;
    }

    if (evidence.sessionId !== null) {
      const promptId = send('session/prompt', {
        sessionId: evidence.sessionId,
        prompt: [{ type: 'text', text: 'Count from 1 to 100, one number per line.' }],
      });

      // Attempt interject as soon as the FIRST session/update notification
      // arrives — a genuine mid-turn attempt, not a post-completion one.
      const interjectDeadline = Date.now() + EXPERIMENT_TIMEOUT_MS;
      let interjectId: number | null = null;
      let underscoredInterjectId: number | null = null;
      for (;;) {
        const remaining = interjectDeadline - Date.now();
        if (remaining <= 0) break;
        const msg = await reader.next(Math.max(1_000, remaining));
        if (msg.id === promptId) {
          evidence.promptAckSeen = msg.error === undefined;
          break;
        }
        if (msg.method !== undefined) {
          evidence.observedNotificationMethods.push(msg.method);
          if (msg.method === 'session/update' && interjectId === null) {
            evidence.sawSessionUpdateBeforeInterject = true;
            evidence.interjectAttempted = true;
            interjectId = send('x.ai/interject', {
              sessionId: evidence.sessionId,
              message: 'Also say the exact word INTERJECT_ACK at the end.',
            });
          }
        }
        if (interjectId !== null && msg.id === interjectId) {
          if (msg.error !== undefined) {
            evidence.interjectSucceeded = false;
            evidence.interjectErrorCode = msg.error.code;
            evidence.interjectErrorMessage = msg.error.message;
            // Every OTHER server-emitted x.ai notification in this session
            // uses the `_x.ai/...` namespace — retry once with that prefix
            // before concluding the method is genuinely unreachable. Params
            // mirror `session/prompt`'s ContentBlock[] shape (`prompt`, not
            // `message`) — every other ACP-family method here uses it.
            if (msg.error.code === -32601 && underscoredInterjectId === null) {
              underscoredInterjectId = send('_x.ai/interject', {
                sessionId: evidence.sessionId,
                prompt: [
                  { type: 'text', text: 'Also say the exact word INTERJECT_ACK at the end.' },
                ],
              });
              evidence.underscoredInterjectAttempted = true;
            }
          } else {
            evidence.interjectSucceeded = true;
          }
        }
        if (underscoredInterjectId !== null && msg.id === underscoredInterjectId) {
          if (msg.error !== undefined) {
            evidence.underscoredInterjectSucceeded = false;
            evidence.underscoredInterjectErrorCode = msg.error.code;
            evidence.underscoredInterjectErrorMessage = msg.error.message;
          } else {
            evidence.underscoredInterjectSucceeded = true;
          }
        }
      }
    }
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error);
    process.stderr.write(`spike error: ${evidence.failure}\n`);
  } finally {
    try {
      proc.kill();
    } catch {
      // already exited
    }
    await Promise.race([proc.exited, new Promise(resolve => setTimeout(resolve, 3_000))]).catch(
      () => undefined
    );
    rmSync(cwd, { recursive: true, force: true });
  }

  return evidence;
}

export type InterjectVerdict = 'verified' | 'unverified';

/**
 * The spec's bar for flipping softInjection/deliveryAck on Grok: at least
 * one interject attempt (either method-name variant) must return a genuine
 * JSON-RPC result, not an error. A "recognized but rejected" method
 * (-32602 Invalid params) is real progress worth recording but is not a
 * verified capability — the exact param shape must actually work.
 */
export function classifyInterjectVerdict(evidence: AcpHandshakeEvidence): InterjectVerdict {
  if (evidence.failure !== null) return 'unverified';
  if (evidence.interjectSucceeded || evidence.underscoredInterjectSucceeded) return 'verified';
  return 'unverified';
}

function readInstalledGrokVersion(): string {
  return execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  const grokVersion = readInstalledGrokVersion();
  const evidence = await runHandshakeSpike(grokVersion);
  const document = { ...evidence, interjectVerdict: classifyInterjectVerdict(evidence) };
  process.stdout.write(`${JSON.stringify(document)}\n`);
  if (document.interjectVerdict === 'unverified') process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
