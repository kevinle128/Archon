/**
 * Diagnostic-only Grok ACP `session/cancel` spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * The shipped adapter's Stop path is blocked because it kills the OS process
 * tree from outside (`--single` argv mode has no other option) and Grok's
 * own descendant tool processes survive that kill on the currently installed
 * binary. `grok agent stdio` speaks the Agent Client Protocol, which defines
 * an in-band `session/cancel` client-to-agent NOTIFICATION: instead of the
 * host killing anything, the host tells the running agent process to stop
 * its own turn, and the agent is responsible for tearing down whatever it
 * spawned. This spike tests whether that in-band path avoids the descendant
 * survival failure `interrupt-resume-spike.ts` (B7/B9) found on the SIGTERM
 * path, and whether the SAME session/process can be redirected afterward
 * with no respawn (mirroring the OMP RPC-mode redirect-with-context proof).
 *
 * Steps per trial:
 *  1. initialize -> session/new against a real `grok agent stdio` process.
 *     Any `session/request_permission` request the agent sends back is
 *     auto-approved (`--always-approve` is also passed, but this spike does
 *     not assume that flag suppresses the protocol-level request too).
 *  2. session/prompt: plant a random token, then run a local script (via the
 *     shell tool) that writes its own PID to a file and sleeps well past the
 *     cancel window, in the foreground (not backgrounded), so a genuine OS
 *     descendant exists to fingerprint.
 *  3. Poll for the script's PID file, fingerprint that descendant.
 *  4. Send `session/cancel` (a notification: no `id`, no direct response) as
 *     soon as the descendant is confirmed alive.
 *  5. Wait for the pending `session/prompt` response, recording elapsed time
 *     and any `stopReason` in the settled response or in intervening
 *     `session/update` notifications.
 *  6. Re-check the fingerprinted descendant's liveness after a short settle.
 *  7. Send a SECOND `session/prompt` on the identical session (no `--resume`,
 *     no respawn — same pid throughout) asking for the planted token back,
 *     and scan every notification/response for that token to prove the
 *     process retained turn-1 context.
 *
 * Output is a single sanitized JSON evidence document per trial on stdout:
 * booleans, timings, and event/method names only — no prompt text beyond the
 * synthetic random token used purely to prove context retention, no model
 * output, no credentials.
 *
 * Optional env:
 *  GROK_SPIKE_TRIALS    number of trials to run (default 3)
 *  GROK_SPIKE_BIN_PATH  override binary path
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveGrokBinaryPath } from './binary-resolver';

const READY_TIMEOUT_MS = 15_000;
const PID_FILE_WAIT_MS = 45_000;
const SETTLEMENT_TIMEOUT_MS = 30_000;
const REDIRECT_TIMEOUT_MS = 45_000;
const FAST_MODEL = 'grok-4.7-build-fast';
const SLOW_SCRIPT = 'slow_tool.sh';
const SLOW_PID_FILE = 'slow_tool.pid';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

interface PermissionOption {
  optionId?: string;
  kind?: string;
}

/** The minimal `Bun.spawn` subprocess shape this spike depends on. */
interface AcpChildProcess {
  readonly stdin: { write(data: string): number | Promise<number>; flush(): void };
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
  kill(): void;
}

/**
 * Bidirectional ACP connection over one `grok agent stdio` child process.
 * Unlike a simple pull-one-message-at-a-time reader, this keeps a background
 * pump running for the whole trial so a `session/request_permission` request
 * from the agent gets answered immediately no matter what the trial's main
 * flow happens to be waiting on at that moment (a plain PID-file poll loop,
 * for instance, never calls into a message reader at all).
 */
class AcpConnection {
  private nextId = 1;
  private readonly pendingResponses = new Map<number, (msg: JsonRpcMessage) => void>();
  private readonly notifications: JsonRpcMessage[] = [];
  private buffer = '';
  readonly observedMethods: string[] = [];
  readonly permissionRequestsSeen: string[] = [];
  readonly serverRequestsSeen: string[] = [];
  readonly sessionUpdateKindsSeen = new Set<string>();

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
      this.handleServerRequest(msg);
      return;
    }
    if (msg.method !== undefined) {
      this.observedMethods.push(msg.method);
      if (msg.method === 'session/update') {
        const params = msg.params as { update?: { sessionUpdate?: string } } | undefined;
        const kind = params?.update?.sessionUpdate;
        if (kind) this.sessionUpdateKindsSeen.add(kind);
      }
    }
    this.notifications.push(msg);
  }

  private write(payload: Record<string, unknown>): void {
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    this.proc.stdin.flush();
  }

  private handleServerRequest(msg: JsonRpcMessage): void {
    if (msg.method !== undefined) this.serverRequestsSeen.push(msg.method);
    if (msg.method === 'session/request_permission') {
      this.permissionRequestsSeen.push(msg.method);
      const params = msg.params as { options?: PermissionOption[] } | undefined;
      const options = params?.options ?? [];
      const allow =
        options.find(option => option.kind === 'allow_always') ??
        options.find(option => (option.kind ?? '').startsWith('allow')) ??
        options[0];
      if (allow?.optionId) {
        this.write({
          jsonrpc: '2.0',
          id: msg.id,
          result: { outcome: { outcome: 'selected', optionId: allow.optionId } },
        });
      } else {
        this.write({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } });
      }
      return;
    }
    // An unhandled server->client request must still get a reply, or the
    // agent blocks on it for the rest of the trial.
    this.write({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32601, message: 'Method not found' },
    });
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

  /** Checkpoint for {@link hasAgentTextSince}, so a later scan ignores history replay. */
  get notificationCount(): number {
    return this.notifications.length;
  }

  /**
   * True only if the model's own generated text at or after `sinceIndex`
   * contains `needle`, once every `agent_message_chunk` fragment in that
   * range is concatenated first. A single BPE token boundary can split a
   * short planted token across several chunks (e.g. "ARCH" / "ON" / "_" /
   * "CANCEL" / …), so checking each notification's text in isolation is a
   * false NEGATIVE by construction — confirmed against a live response
   * where the model recalled a token correctly but no single chunk carried
   * it whole. Scoped to start at `sinceIndex` (rather than the whole
   * history) for the opposite reason: the token also appears verbatim in
   * the ORIGINAL user prompt notification, and `session/load` replays that
   * whole history back as notifications before its response resolves.
   */
  hasAgentTextSince(sinceIndex: number, needle: string): boolean {
    let text = '';
    for (let i = sinceIndex; i < this.notifications.length; i += 1) {
      const msg = this.notifications[i];
      if (msg?.method !== 'session/update') continue;
      const params = msg.params as
        | { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } }
        | undefined;
      const update = params?.update;
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
        text += update.content.text ?? '';
      }
    }
    return text.includes(needle);
  }
}

function fingerprint(pid: number, startTime: string | null): string {
  return startTime ? `pid=${String(pid)};start=${startTime}` : `pid=${String(pid)}`;
}

function runCommand(args: string[]): { stdout: string; success: boolean } {
  try {
    const stdout = execFileSync(args[0] ?? '', args.slice(1), { encoding: 'utf8' });
    return { stdout, success: true };
  } catch {
    return { stdout: '', success: false };
  }
}

function readStartTime(pid: number): string | null {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
      const closeParen = stat.lastIndexOf(')');
      const fields = stat.slice(closeParen + 2).split(' ');
      return fields[19] ?? null;
    }
    if (process.platform === 'darwin') {
      const out = runCommand(['ps', '-o', 'lstart=', '-p', String(pid)]).stdout.trim();
      return out.length > 0 ? out : null;
    }
  } catch {
    return null;
  }
  return null;
}

function readProcessState(pid: number): string | null {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
      const closeParen = stat.lastIndexOf(')');
      return stat.slice(closeParen + 2, closeParen + 3) || null;
    }
    if (process.platform === 'darwin') {
      const out = runCommand(['ps', '-o', 'stat=', '-p', String(pid)]).stdout.trim();
      return out.length > 0 ? (out[0] ?? null) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function readParentPid(pid: number): number | null {
  const out = runCommand(['ps', '-o', 'ppid=', '-p', String(pid)]).stdout.trim();
  const value = Number(out);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Walks the parent-pid chain from `descendantPid` looking for `ancestorPid`.
 * Stopping at pid 1 (or a broken chain) without finding it means the
 * descendant was re-parented onto a new session/process group — the
 * mechanism a plain `kill(-pgid)` cannot reach, which is the leading
 * hypothesis for why `interrupt-resume-spike.ts` (B7/B9) finds surviving
 * descendants on the SIGTERM path.
 */
function isDescendantOfProcess(descendantPid: number, ancestorPid: number): boolean {
  let current: number | null = descendantPid;
  for (let hop = 0; hop < 20 && current !== null; hop += 1) {
    if (current === ancestorPid) return true;
    if (current <= 1) return false;
    current = readParentPid(current);
  }
  return false;
}

function isFingerprintAlive(fp: string): boolean {
  const match = /^pid=(\d+)/.exec(fp);
  if (!match) return false;
  const pid = Number(match[1]);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const state = readProcessState(pid);
  if (state === 'Z' || state === 'X') return false;
  const expectedStart = /;start=(.+)$/.exec(fp)?.[1] ?? null;
  if (!expectedStart) return true;
  const liveStart = readStartTime(pid);
  if (liveStart === null) return true;
  return liveStart === expectedStart;
}

function readPidFile(path: string): number | null {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

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

/** Recursively scans any JSON-ish value for a `stopReason`-shaped field. */
function extractStopReason(value: unknown): string | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.stopReason === 'string') return record.stopReason;
    for (const entry of Object.values(record)) {
      const found = extractStopReason(entry);
      if (found !== null) return found;
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = extractStopReason(entry);
      if (found !== null) return found;
    }
  }
  return null;
}

export interface SessionCancelTrialEvidence {
  grokVersion: string;
  initializeSucceeded: boolean;
  sessionNewSucceeded: boolean;
  sessionId: string | null;
  permissionRequestsAutoApproved: number;
  serverRequestsSeen: string[];
  descendantPidCaptured: boolean;
  descendantAliveBeforeCancel: boolean | null;
  /** False means the descendant was re-parented off `proc`'s tree by the time it was fingerprinted. */
  descendantInAgentTree: boolean | null;
  cancelSent: boolean;
  promptSettledAfterCancel: boolean;
  promptStopReason: string | null;
  cancelToSettlementMs: number | null;
  descendantsAliveAfterCancel: boolean | null;
  redirectPromptSettled: boolean;
  redirectProvedContext: boolean;
  /**
   * Archon's actual production shape: a fresh `sendQuery()` process per call,
   * not one warm connection held across turns. This tests resuming the SAME
   * sessionId from a brand-new `grok agent stdio` process (kill + respawn),
   * which is what the real integration would need — not the same-process
   * redirect above, which only proves the transport CAN stay warm.
   */
  crossProcessResumeMethod: 'session/load' | 'session/resume' | 'none';
  crossProcessResumeSettled: boolean;
  crossProcessResumeProvedContext: boolean;
  /** Kept separate from `failure` so a resume-leg problem can't mark the cancel/reap verdict inconclusive. */
  crossProcessResumeError: string | null;
  observedNotificationMethods: string[];
  sessionUpdateKindsSeen: string[];
  failure: string | null;
}

function emptyEvidence(grokVersion: string): SessionCancelTrialEvidence {
  return {
    grokVersion,
    initializeSucceeded: false,
    sessionNewSucceeded: false,
    sessionId: null,
    permissionRequestsAutoApproved: 0,
    serverRequestsSeen: [],
    descendantPidCaptured: false,
    descendantAliveBeforeCancel: null,
    descendantInAgentTree: null,
    cancelSent: false,
    promptSettledAfterCancel: false,
    promptStopReason: null,
    cancelToSettlementMs: null,
    descendantsAliveAfterCancel: null,
    redirectPromptSettled: false,
    redirectProvedContext: false,
    crossProcessResumeMethod: 'none',
    crossProcessResumeSettled: false,
    crossProcessResumeProvedContext: false,
    crossProcessResumeError: null,
    observedNotificationMethods: [],
    sessionUpdateKindsSeen: [],
    failure: null,
  };
}

async function runTrial(
  grokVersion: string,
  binaryPath: string
): Promise<SessionCancelTrialEvidence> {
  const evidence = emptyEvidence(grokVersion);
  const cwd = mkdtempSync(join(tmpdir(), 'archon-grok-cancel-spike-'));
  writeSlowToolScript(cwd);
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
  const conn = new AcpConnection(proc);
  const syncConnEvidence = (): void => {
    evidence.permissionRequestsAutoApproved = conn.permissionRequestsSeen.length;
    evidence.serverRequestsSeen = [...new Set(conn.serverRequestsSeen)];
    evidence.observedNotificationMethods = [...new Set(conn.observedMethods)];
    evidence.sessionUpdateKindsSeen = [...conn.sessionUpdateKindsSeen];
  };

  try {
    // No client-side `fs`/`terminal` delegation: the point of this trial is
    // that grok runs (and is responsible for reaping) its own tool process,
    // matching the `--single` transport's behavior, not a delegated shell.
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
      { cwd, mcpServers: [], _meta: { yoloMode: true } },
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

    const token = `ARCHON_CANCEL_TOKEN_${randomUUID().slice(0, 8)}`;
    const promptPromise = conn.request(
      'session/prompt',
      {
        sessionId,
        prompt: [
          {
            type: 'text',
            text:
              `Remember this exact token: ${token}. Then, using the shell/terminal tool, run the ` +
              `local script "./${SLOW_SCRIPT}" in the foreground (do not background it, do not ` +
              'use nohup or &). Wait for it to finish before replying.',
          },
        ],
      },
      SETTLEMENT_TIMEOUT_MS + PID_FILE_WAIT_MS
    );

    const pidPath = join(cwd, SLOW_PID_FILE);
    const pidDeadline = Date.now() + PID_FILE_WAIT_MS;
    let descendantFingerprint: string | null = null;
    while (Date.now() < pidDeadline && descendantFingerprint === null) {
      if (existsSync(pidPath)) {
        const pid = readPidFile(pidPath);
        if (pid !== null) descendantFingerprint = fingerprint(pid, readStartTime(pid));
      }
      if (descendantFingerprint === null) await delay(100);
    }
    evidence.descendantPidCaptured = descendantFingerprint !== null;
    syncConnEvidence();

    if (descendantFingerprint === null) {
      evidence.failure = 'descendant pid file never appeared';
      conn.notify('session/cancel', { sessionId });
      evidence.cancelSent = true;
      const settled = await promptPromise.catch(() => null);
      evidence.promptSettledAfterCancel = settled !== null && settled.error === undefined;
      evidence.promptStopReason = settled ? extractStopReason(settled.result) : null;
      return evidence;
    }
    evidence.descendantAliveBeforeCancel = isFingerprintAlive(descendantFingerprint);
    const descendantPid = Number(/^pid=(\d+)/.exec(descendantFingerprint)?.[1] ?? 0);
    evidence.descendantInAgentTree =
      descendantPid > 0 ? isDescendantOfProcess(descendantPid, proc.pid) : null;

    const cancelSentAt = Date.now();
    conn.notify('session/cancel', { sessionId });
    evidence.cancelSent = true;
    const promptResponse = await promptPromise;
    evidence.promptSettledAfterCancel = promptResponse.error === undefined;
    evidence.promptStopReason = extractStopReason(promptResponse.result);
    evidence.cancelToSettlementMs = Date.now() - cancelSentAt;
    syncConnEvidence();

    await delay(150);
    let stillAlive = isFingerprintAlive(descendantFingerprint);
    if (stillAlive) {
      await delay(350);
      stillAlive = isFingerprintAlive(descendantFingerprint);
    }
    evidence.descendantsAliveAfterCancel = stillAlive;
    if (stillAlive) {
      const pid = Number(/^pid=(\d+)/.exec(descendantFingerprint)?.[1] ?? 0);
      if (pid > 0) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }

    // Redirect on the SAME session/process: no --resume, no respawn. The
    // checkpoint is taken BEFORE sending, so only this turn's own generated
    // text counts — the token is also present verbatim in turn 1's own
    // prompt notification, which would otherwise be a false positive.
    const redirectCheckpoint = conn.notificationCount;
    const redirectResponse = await conn.request(
      'session/prompt',
      {
        sessionId,
        prompt: [
          {
            type: 'text',
            text: 'What was the exact token I asked you to remember earlier in this session? Reply with only that token.',
          },
        ],
      },
      REDIRECT_TIMEOUT_MS
    );
    evidence.redirectPromptSettled = redirectResponse.error === undefined;
    evidence.redirectProvedContext = conn.hasAgentTextSince(redirectCheckpoint, token);
    syncConnEvidence();

    // Kill this process for real, then reconnect from a BRAND NEW process —
    // this is what production would actually need, since Archon spawns a
    // fresh sendQuery() process per call rather than holding one connection
    // open across turns.
    try {
      proc.kill();
    } catch {
      // already exited
    }
    await Promise.race([proc.exited, new Promise(resolve => setTimeout(resolve, 3_000))]).catch(
      () => undefined
    );

    const proc2 = Bun.spawn(
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
    const conn2 = new AcpConnection(proc2);
    try {
      const init2 = await conn2.request(
        'initialize',
        { protocolVersion: 1, clientCapabilities: {} },
        READY_TIMEOUT_MS
      );
      if (init2.error !== undefined) {
        evidence.crossProcessResumeError = `respawn initialize failed: ${JSON.stringify(init2.error)}`;
      } else {
        let loadResponse = await conn2.request(
          'session/load',
          { sessionId, cwd, mcpServers: [] },
          READY_TIMEOUT_MS
        );
        evidence.crossProcessResumeMethod = 'session/load';
        if (loadResponse.error?.code === -32601) {
          loadResponse = await conn2.request(
            'session/resume',
            { sessionId, cwd, mcpServers: [] },
            READY_TIMEOUT_MS
          );
          evidence.crossProcessResumeMethod = 'session/resume';
        }
        if (loadResponse.error !== undefined) {
          evidence.crossProcessResumeMethod = 'none';
          evidence.crossProcessResumeError = `cross-process resume failed: ${JSON.stringify(loadResponse.error)}`;
        } else {
          // Checkpoint AFTER load/resume resolves: its own response replays
          // turn 1's history (including the token-bearing user prompt) as
          // notifications before it settles, which would otherwise be a
          // false positive for "the model recalled it."
          const resumeCheckpoint = conn2.notificationCount;
          const resumePrompt = await conn2.request(
            'session/prompt',
            {
              sessionId,
              prompt: [
                {
                  type: 'text',
                  text: 'What was the exact token I asked you to remember earlier in this session? Reply with only that token.',
                },
              ],
            },
            REDIRECT_TIMEOUT_MS
          );
          evidence.crossProcessResumeSettled = resumePrompt.error === undefined;
          evidence.crossProcessResumeProvedContext = conn2.hasAgentTextSince(
            resumeCheckpoint,
            token
          );
        }
      }
    } finally {
      try {
        proc2.kill();
      } catch {
        // already exited
      }
      await Promise.race([proc2.exited, new Promise(resolve => setTimeout(resolve, 3_000))]).catch(
        () => undefined
      );
    }
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error);
    process.stderr.write(`spike trial error: ${evidence.failure}\n`);
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

export type CancelVerdict = 'clean-stop' | 'descendant-leak' | 'inconclusive';

/**
 * The bar for treating `session/cancel` as a viable replacement for the
 * SIGTERM/SIGKILL Stop path: the prompt must settle after cancel, the
 * fingerprinted descendant must be confirmed alive immediately before cancel
 * (so its later absence is evidence of cleanup, not a race), and it must be
 * gone afterward.
 */
export function classifyCancelVerdict(evidence: SessionCancelTrialEvidence): CancelVerdict {
  if (evidence.failure !== null) return 'inconclusive';
  if (!evidence.descendantPidCaptured || evidence.descendantAliveBeforeCancel !== true) {
    return 'inconclusive';
  }
  if (!evidence.promptSettledAfterCancel) return 'inconclusive';
  if (evidence.descendantsAliveAfterCancel === false) return 'clean-stop';
  return 'descendant-leak';
}

function readInstalledGrokVersion(binaryPath: string): string {
  return execFileSync(binaryPath, ['--version'], { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  const trialCount = Number(process.env.GROK_SPIKE_TRIALS ?? '3');
  const binaryPath = await resolveGrokBinaryPath(process.env.GROK_SPIKE_BIN_PATH, process.env);
  const grokVersion = readInstalledGrokVersion(binaryPath);
  const trials: SessionCancelTrialEvidence[] = [];
  for (let i = 0; i < trialCount; i += 1) {
    trials.push(await runTrial(grokVersion, binaryPath));
  }
  const verdicts = trials.map(classifyCancelVerdict);
  const document = {
    grokVersion,
    trials,
    verdicts,
    allCleanStop: verdicts.length > 0 && verdicts.every(v => v === 'clean-stop'),
  };
  process.stdout.write(`${JSON.stringify(document)}\n`);
  if (!document.allCleanStop) process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
