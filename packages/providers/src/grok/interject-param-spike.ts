/**
 * Diagnostic-only Grok ACP `_x.ai/interject` parameter-shape spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * `acp-handshake-spike.ts` proved `_x.ai/interject` is a REGISTERED method on
 * `grok agent stdio` (JSON-RPC -32602 "Invalid params", not -32601 "Method
 * not found"), but neither of its two guessed param shapes
 * (`{sessionId, message}` / `{sessionId, prompt: ContentBlock[]}`) was
 * accepted. Strings recovered from the grok binary itself, adjacent to the
 * pager's own "couldn't send interjection: serialize interject params"
 * error path, name three candidate fields the earlier guesses did not try:
 * `content` (not `message`/`prompt`), `targetPromptIndex`, and
 * `conversation_only`. This spike tries those combinations empirically, with
 * `--debug --debug-file` enabled so a serde rejection's own diagnostic (which
 * names the missing/unexpected field) is captured for evidence rather than
 * just the bare JSON-RPC error code.
 *
 * Output is a single sanitized JSON evidence document on stdout per shape
 * tried: JSON-RPC error codes/data, event TYPES, and boolean facts only — no
 * prompt text beyond the fixed diagnostic strings below, no model output, no
 * credentials. The debug log path is recorded but its contents are not
 * echoed to stdout (read separately if deeper triage is needed).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveGrokBinaryPath } from './binary-resolver';

const READY_TIMEOUT_MS = 15_000;
const PID_FILE_WAIT_MS = 30_000;
const PROMPT_TIMEOUT_MS = 130_000;
const INTERJECT_TIMEOUT_MS = 10_000;
const FAST_MODEL = 'grok-4.7-build-fast';
const SLOW_SCRIPT = 'slow_tool.sh';
const SLOW_PID_FILE = 'slow_tool.pid';

function writeSlowToolScript(cwd: string): void {
  const scriptPath = join(cwd, SLOW_SCRIPT);
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env sh
set -eu
echo $$ > "${SLOW_PID_FILE}"
sleep 120
`,
    'utf8'
  );
  chmodSync(scriptPath, 0o755);
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

/**
 * Minimal single-purpose ACP connection for the interject param-shape trial:
 * only tracks request/response correlation and auto-approves permission
 * requests, since the one thing this spike needs live is the tool-using
 * turn staying open long enough to attempt several interject shapes.
 */
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
      // Any other server->client request must still get a reply, or the
      // agent blocks on it for the rest of the trial.
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

interface InterjectAttemptResult {
  shapeLabel: string;
  method: '_x.ai/interject' | 'x.ai/interject';
  /** False means the turn had already settled before this attempt was sent — a
   * rejection on a dead turn is not the same finding as one on a live turn. */
  turnActiveAtAttempt: boolean;
  succeeded: boolean;
  errorCode: number | null;
  errorMessage: string | null;
  errorData: unknown;
}

async function tryShape(
  conn: MinimalAcpConnection,
  method: '_x.ai/interject' | 'x.ai/interject',
  shapeLabel: string,
  params: unknown,
  isTurnActive: () => boolean
): Promise<InterjectAttemptResult> {
  const turnActiveAtAttempt = isTurnActive();
  try {
    const response = await conn.request(method, params, INTERJECT_TIMEOUT_MS);
    return {
      shapeLabel,
      method,
      turnActiveAtAttempt,
      succeeded: response.error === undefined,
      errorCode: response.error?.code ?? null,
      errorMessage: response.error?.message ?? null,
      errorData: response.error?.data ?? null,
    };
  } catch (error) {
    return {
      shapeLabel,
      method,
      turnActiveAtAttempt,
      succeeded: false,
      errorCode: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorData: null,
    };
  }
}

export interface InterjectParamSpikeEvidence {
  grokVersion: string;
  initializeSucceeded: boolean;
  sessionNewSucceeded: boolean;
  sessionId: string | null;
  descendantPidCaptured: boolean;
  attempts: InterjectAttemptResult[];
  anySucceeded: boolean;
  debugLogPath: string;
  failure: string | null;
}

async function runSpike(
  grokVersion: string,
  binaryPath: string
): Promise<InterjectParamSpikeEvidence> {
  const cwd = mkdtempSync(join(tmpdir(), 'archon-grok-interject-spike-'));
  const debugLogPath = join(cwd, 'grok-debug.log');
  writeSlowToolScript(cwd);
  const evidence: InterjectParamSpikeEvidence = {
    grokVersion,
    initializeSucceeded: false,
    sessionNewSucceeded: false,
    sessionId: null,
    descendantPidCaptured: false,
    attempts: [],
    anySucceeded: false,
    debugLogPath,
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
      '--debug',
      '--debug-file',
      debugLogPath,
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
    evidence.initializeSucceeded = initResponse.error === undefined;
    if (!evidence.initializeSucceeded) {
      evidence.failure = `initialize failed: ${JSON.stringify(initResponse.error)}`;
      return evidence;
    }

    const sessionResponse = await conn.request(
      'session/new',
      { cwd, mcpServers: [] },
      READY_TIMEOUT_MS
    );
    evidence.sessionNewSucceeded = sessionResponse.error === undefined;
    const sessionResult = sessionResponse.result as { sessionId?: string } | undefined;
    evidence.sessionId =
      typeof sessionResult?.sessionId === 'string' ? sessionResult.sessionId : null;
    if (evidence.sessionId === null) {
      evidence.failure = `session/new failed: ${JSON.stringify(sessionResponse.error)}`;
      return evidence;
    }
    const sessionId = evidence.sessionId;

    // The turn runs a 120s foreground shell script, not a short model-only
    // reply: a fast/low-effort model can finish plain text generation before
    // an attempt loop gets through its shapes, and a -32602 on an already-
    // settled turn is not the same finding as one on a genuinely live turn.
    let promptSettled = false;
    const promptPromise = conn
      .request(
        'session/prompt',
        {
          sessionId,
          prompt: [
            {
              type: 'text',
              text:
                `Using the shell/terminal tool, run the local script "./${SLOW_SCRIPT}" in the ` +
                'foreground (do not background it, do not use nohup or &). Wait for it to finish ' +
                'before replying.',
            },
          ],
        },
        PROMPT_TIMEOUT_MS
      )
      .catch(() => undefined);
    void promptPromise.finally(() => {
      promptSettled = true;
    });

    const pidPath = join(cwd, SLOW_PID_FILE);
    const pidDeadline = Date.now() + PID_FILE_WAIT_MS;
    while (Date.now() < pidDeadline && !existsSync(pidPath)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    evidence.descendantPidCaptured = existsSync(pidPath);

    // Round 1 (ContentBlock[] under `content`, all six combinations) failed
    // uniformly with "missing field `text`" — the wrapper struct expects a
    // flat `text` field, not the nested ContentBlock array `session/prompt`
    // uses. Round 2 tries `text` at every nesting level round 1 covered.
    const message = 'Also say the exact word INTERJECT_ACK.';
    const shapes: { label: string; params: unknown }[] = [
      { label: 'flat-text', params: { sessionId, text: message } },
      {
        label: 'flat-text+targetPromptIndex',
        params: { sessionId, text: message, targetPromptIndex: 0 },
      },
      {
        label: 'flat-text+conversation_only',
        params: { sessionId, text: message, conversation_only: false },
      },
      {
        label: 'flat-text+targetPromptIndex+conversation_only',
        params: { sessionId, text: message, targetPromptIndex: 0, conversation_only: false },
      },
      {
        label: 'content-object-text',
        params: { sessionId, content: { type: 'text', text: message } },
      },
      {
        label: 'content-object-text+targetPromptIndex',
        params: { sessionId, content: { type: 'text', text: message }, targetPromptIndex: 0 },
      },
    ];

    const isTurnActive = (): boolean => !promptSettled;
    for (const shape of shapes) {
      // Sequential by design: each attempt's error (or success) must be
      // attributable to its own exact param shape, not a race with another.
      const underscored = await tryShape(
        conn,
        '_x.ai/interject',
        shape.label,
        shape.params,
        isTurnActive
      );
      evidence.attempts.push(underscored);
      if (underscored.succeeded) {
        evidence.anySucceeded = true;
        break;
      }
    }
    if (!evidence.anySucceeded) {
      // One control attempt on the unprefixed name, matching the pager's own
      // literal call site, in case the earlier -32601 was version-specific.
      const bare = await tryShape(
        conn,
        'x.ai/interject',
        'flat-text (bare method name)',
        { sessionId, text: message },
        isTurnActive
      );
      evidence.attempts.push(bare);
      evidence.anySucceeded = bare.succeeded;
    }

    // Best-effort cleanup of the still-running tool turn before teardown.
    conn.notify('session/cancel', { sessionId });
    await Promise.race([promptPromise, new Promise(resolve => setTimeout(resolve, 3_000))]);
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
  if (!evidence.anySucceeded) process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
