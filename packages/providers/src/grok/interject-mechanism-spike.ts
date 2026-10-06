/**
 * Diagnostic-only Grok ACP `_x.ai/interject` mechanism spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * `interject-param-spike.ts` proved the call itself succeeds with
 * `{sessionId, text}` — a genuine JSON-RPC result, not an error. That alone
 * does not prove mid-turn steering (CAP-12): the same ack shape would also
 * be produced by a followup queued to run AFTER the current turn finishes
 * (CAP-8), which is exactly what the F1 phase found for OMP's RPC `steer`.
 * This spike runs the same discriminator OMP was tested with: a turn with
 * two SEQUENTIAL shell tool calls, an interject sent in the gap between the
 * first call's completion and the second call's dispatch instructing the
 * model to skip the second one, then a check of whether the second call ran
 * anyway.
 *
 * Output is a single sanitized JSON evidence document on stdout: booleans,
 * timings, and event/method names only — no prompt text beyond the fixed
 * diagnostic strings below, no model output, no credentials.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveGrokBinaryPath } from './binary-resolver';

const READY_TIMEOUT_MS = 15_000;
const MARKER_WAIT_MS = 30_000;
const PROMPT_TIMEOUT_MS = 60_000;
const FAST_MODEL = 'grok-4.7-build-fast';
const FIRST_SCRIPT = 'first_call.sh';
const SECOND_SCRIPT = 'second_call.sh';
const FIRST_MARKER = 'first_call.done';
const SECOND_MARKER = 'second_call.done';

function writeMarkerScripts(cwd: string): void {
  for (const [script, marker] of [
    [FIRST_SCRIPT, FIRST_MARKER],
    [SECOND_SCRIPT, SECOND_MARKER],
  ] as const) {
    const scriptPath = join(cwd, script);
    writeFileSync(scriptPath, `#!/usr/bin/env sh\nset -eu\ntouch "${marker}"\n`, 'utf8');
    chmodSync(scriptPath, 0o755);
  }
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface AcpChildProcess {
  readonly stdin: { write(data: string): number | Promise<number>; flush(): void };
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
  kill(): void;
}

class MinimalAcpConnection {
  private nextId = 1;
  private readonly pendingResponses = new Map<number, (msg: JsonRpcMessage) => void>();
  private buffer = '';

  constructor(private readonly proc: AcpChildProcess) {
    void this.pump();
  }

  private async pump(): Promise<void> {
    const stdout = this.proc.stdout;
    if (!(stdout instanceof ReadableStream)) return;
    const decoder = new TextDecoder();
    for await (const chunk of stdout) {
      this.buffer += decoder.decode(chunk);
      let newline = this.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line.length > 0) {
          try {
            this.handle(JSON.parse(line) as JsonRpcMessage);
          } catch {
            // Malformed line — skip; not a protocol conformance concern here.
          }
        }
        newline = this.buffer.indexOf('\n');
      }
    }
  }

  private handle(msg: JsonRpcMessage): void {
    if (msg.id !== undefined && msg.method === undefined) {
      const resolve = this.pendingResponses.get(msg.id as number);
      if (resolve) {
        this.pendingResponses.delete(msg.id as number);
        resolve(msg);
      }
      return;
    }
    if (msg.id !== undefined && msg.method !== undefined) {
      if (msg.method === 'session/request_permission') {
        const params = msg.params as
          | { options?: { optionId?: string; kind?: string }[] }
          | undefined;
        const options = params?.options ?? [];
        const allow =
          options.find(option => option.kind === 'allow_always') ??
          options.find(option => (option.kind ?? '').startsWith('allow')) ??
          options[0];
        this.write({
          jsonrpc: '2.0',
          id: msg.id,
          result: allow?.optionId
            ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
            : { outcome: { outcome: 'cancelled' } },
        });
        return;
      }
      this.write({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: 'Method not found' },
      });
    }
  }

  private write(payload: Record<string, unknown>): void {
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    this.proc.stdin.flush();
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    const result = new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(id);
        reject(new Error(`request ${method} (${String(id)}) timed out`));
      }, timeoutMs);
      this.pendingResponses.set(id, msg => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
    this.write({ jsonrpc: '2.0', id, method, params });
    return result;
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }
}

export interface InterjectMechanismEvidence {
  grokVersion: string;
  firstCallCompleted: boolean;
  interjectSent: boolean;
  interjectSucceeded: boolean;
  /** The model dispatched the second tool call despite the interject asking it not to. */
  secondCallRanAnyway: boolean;
  promptSettled: boolean;
  promptStopReason: string | null;
  failure: string | null;
}

async function runSpike(
  grokVersion: string,
  binaryPath: string
): Promise<InterjectMechanismEvidence> {
  const cwd = mkdtempSync(join(tmpdir(), 'archon-grok-interject-mech-'));
  writeMarkerScripts(cwd);
  const evidence: InterjectMechanismEvidence = {
    grokVersion,
    firstCallCompleted: false,
    interjectSent: false,
    interjectSucceeded: false,
    secondCallRanAnyway: false,
    promptSettled: false,
    promptStopReason: null,
    failure: null,
  };
  try {
    execFileSync('git', ['init', '-q'], { cwd });
  } catch {
    // A plain directory still satisfies the child's cwd requirement.
  }

  const proc = Bun.spawn(
    [
      binaryPath,
      'agent',
      '--always-approve',
      '--no-leader',
      '-m',
      FAST_MODEL,
      '--reasoning-effort',
      'low',
      'stdio',
    ],
    { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }
  );
  const conn = new MinimalAcpConnection(proc);

  try {
    const initResponse = await conn.request(
      'initialize',
      { protocolVersion: 1, clientCapabilities: {} },
      READY_TIMEOUT_MS
    );
    if (initResponse.error !== undefined) {
      evidence.failure = `initialize failed: ${JSON.stringify(initResponse.error)}`;
      return evidence;
    }

    const sessionResponse = await conn.request(
      'session/new',
      { cwd, mcpServers: [] },
      READY_TIMEOUT_MS
    );
    const sessionResult = sessionResponse.result as { sessionId?: string } | undefined;
    const sessionId = sessionResult?.sessionId;
    if (typeof sessionId !== 'string') {
      evidence.failure = `session/new failed: ${JSON.stringify(sessionResponse.error)}`;
      return evidence;
    }

    let promptSettledFlag = false;
    let promptStopReasonHolder: string | null = null;
    const promptPromise = conn
      .request(
        'session/prompt',
        {
          sessionId,
          prompt: [
            {
              type: 'text',
              text:
                `Using the shell/terminal tool, run "./${FIRST_SCRIPT}" and wait for it to finish. ` +
                `Then, as a separate second tool call, run "./${SECOND_SCRIPT}" and wait for it to ` +
                'finish. Run them one at a time, not in parallel or combined into one command. ' +
                'After both finish, reply with exactly DONE.',
            },
          ],
        },
        PROMPT_TIMEOUT_MS
      )
      .then(response => {
        const result = response.result as { stopReason?: string } | undefined;
        promptStopReasonHolder = result?.stopReason ?? null;
        return response;
      })
      .catch(() => undefined)
      .finally(() => {
        promptSettledFlag = true;
      });

    const firstMarkerPath = join(cwd, FIRST_MARKER);
    const firstDeadline = Date.now() + MARKER_WAIT_MS;
    while (Date.now() < firstDeadline && !existsSync(firstMarkerPath) && !promptSettledFlag) {
      await delay(100);
    }
    evidence.firstCallCompleted = existsSync(firstMarkerPath);
    if (!evidence.firstCallCompleted) {
      evidence.failure = 'first tool call never completed within the wait window';
      await promptPromise;
      evidence.promptSettled = promptSettledFlag;
      evidence.promptStopReason = promptStopReasonHolder;
      return evidence;
    }

    // Brief settle so the second tool call has not already been dispatched
    // before the interject lands — this is the exact gap OMP's steer test
    // targeted (between one tool's result and the next tool's dispatch).
    await delay(150);
    const interjectResponse = await conn
      .request(
        '_x.ai/interject',
        {
          sessionId,
          text: `Stop now. Do not run "./${SECOND_SCRIPT}". Just reply with exactly STOPPED.`,
        },
        10_000
      )
      .catch(error => ({ error: { code: -1, message: String(error) } }) as JsonRpcMessage);
    evidence.interjectSent = true;
    evidence.interjectSucceeded = interjectResponse.error === undefined;

    await promptPromise;
    evidence.promptSettled = promptSettledFlag;
    evidence.promptStopReason = promptStopReasonHolder;
    evidence.secondCallRanAnyway = existsSync(join(cwd, SECOND_MARKER));
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

function readInstalledGrokVersion(binaryPath: string): string {
  return execFileSync(binaryPath, ['--version'], { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  const binaryPath = await resolveGrokBinaryPath(process.env.GROK_SPIKE_BIN_PATH, process.env);
  const grokVersion = readInstalledGrokVersion(binaryPath);
  const evidence = await runSpike(grokVersion, binaryPath);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  if (evidence.failure !== null || evidence.secondCallRanAnyway) process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
