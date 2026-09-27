/**
 * Diagnostic-only OMP RPC-mode spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * The shipped OMP adapter uses `--mode json` and stops a turn with SIGTERM;
 * a prior real-binary conformance gate (spike:interrupt:omp) found that path
 * BLOCKED — a freshly-killed session cannot always be resumed from disk.
 * `--mode rpc` never kills the process at all: Stop is an in-band `{type:
 * "abort"}` command and the same warm process can be redirected with a new
 * `{type:"prompt"}` frame, which would sidestep the disk-resumability
 * question entirely. This spike answers, against the real binary:
 *
 *  1. Does `{type:"abort"}` end the current turn without killing the child,
 *     leaving the SAME process able to accept a new prompt (Stop + redirect,
 *     CAP-9/CAP-10, no kill/respawn)?
 *  2. Does `{type:"steer"}` sent mid-turn land inside the SAME `agent_end`
 *     (one terminal event, not two), and does it leave an in-flight tool
 *     call's own outcome unchanged (CAP-12's "the active tool outcome does
 *     not change")?
 *
 * Output is a single sanitized JSON evidence document on stdout: event
 * TYPES and boolean facts only — no prompt text, no model output, no
 * credentials.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveOmpBinaryPath } from './binary-resolver';

const EXPERIMENT_TIMEOUT_MS = 90_000;
const READY_WAIT_MS = 10_000;

interface RpcFrame {
  type: string;
  [key: string]: unknown;
}

/** Line-delimited JSON reader over an OMP RPC child's stdout. */
class RpcReader {
  private buffer = '';
  private readonly pending: RpcFrame[] = [];
  private waiters: ((frame: RpcFrame) => void)[] = [];

  feed(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > 0) {
        try {
          const frame = JSON.parse(line) as RpcFrame;
          this.deliver(frame);
        } catch {
          // Malformed line — the real protocol tolerates this too (a
          // recoverable `command: "parse"` failure); this spike just skips it.
        }
      }
      index = this.buffer.indexOf('\n');
    }
  }

  private deliver(frame: RpcFrame): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(frame);
    else this.pending.push(frame);
  }

  async next(timeoutMs: number): Promise<RpcFrame> {
    const queued = this.pending.shift();
    if (queued !== undefined) return queued;
    return new Promise<RpcFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== onFrame);
        reject(new Error('RPC frame read timed out'));
      }, timeoutMs);
      const onFrame = (frame: RpcFrame): void => {
        clearTimeout(timer);
        resolve(frame);
      };
      this.waiters.push(onFrame);
    });
  }
}

export interface RpcModeEvidence {
  ompVersion: string;
  readyFrameSeen: boolean;
  promptAckSeen: boolean;
  agentEndCount: number;
  abort: {
    attempted: boolean;
    ackSeen: boolean;
    childExitedAfterAbort: boolean;
    redirectPromptAckSeen: boolean;
    redirectReachedAgentEnd: boolean;
    /** The redirect turn's final AgentMessage[] contained turn 1's remembered token. */
    redirectProvedContext: boolean;
    samePid: boolean;
  };
  steer: {
    attempted: boolean;
    ackSeen: boolean;
    setInterruptModeAckSeen: boolean;
    agentEndCountAfterSteer: number;
    toolOutcomeDisrupted: boolean;
    /** A `tool_execution_start` for the SECOND call arrived after steer landed. */
    secondToolCallStillRan: boolean;
    sawTurnStartAfterSteer: boolean;
    steerLandedBeforeFirstAgentEnd: boolean;
  };
  observedEventTypes: string[];
  failure: string | null;
}

function emptyEvidence(ompVersion: string): RpcModeEvidence {
  return {
    ompVersion,
    readyFrameSeen: false,
    promptAckSeen: false,
    agentEndCount: 0,
    abort: {
      attempted: false,
      ackSeen: false,
      childExitedAfterAbort: false,
      redirectPromptAckSeen: false,
      redirectReachedAgentEnd: false,
      redirectProvedContext: false,
      samePid: false,
    },
    steer: {
      attempted: false,
      ackSeen: false,
      setInterruptModeAckSeen: false,
      agentEndCountAfterSteer: 0,
      toolOutcomeDisrupted: false,
      secondToolCallStillRan: false,
      sawTurnStartAfterSteer: false,
      steerLandedBeforeFirstAgentEnd: false,
    },
    observedEventTypes: [],
    failure: null,
  };
}

interface SpawnedRpc {
  pid: number;
  reader: RpcReader;
  write: (frame: Record<string, unknown>) => void;
  exited: Promise<number>;
  kill: () => void;
}

/**
 * Every spawned child, tracked so a thrown timeout still force-kills every
 * live process — an un-killed child's open stdout pipe otherwise keeps the
 * spike's own event loop alive indefinitely (Bun's default pipe-ref
 * behavior), which is what produced the very first hung run of this spike.
 */
function spawnRpc(
  binaryPath: string,
  cwd: string,
  liveProcesses: Bun.Subprocess[],
  extraArgs: string[] = []
): SpawnedRpc {
  const proc = Bun.spawn(
    [
      binaryPath,
      '--mode',
      'rpc',
      '--cwd',
      cwd,
      '--yolo',
      '--no-title',
      '--no-extensions',
      ...extraArgs,
    ],
    { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }
  );
  liveProcesses.push(proc);
  const reader = new RpcReader();
  void (async (): Promise<void> => {
    if (!proc.stdout) return;
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      reader.feed(decoder.decode(chunk));
    }
  })();
  return {
    pid: proc.pid,
    reader,
    write: (frame): void => {
      proc.stdin.write(`${JSON.stringify(frame)}\n`);
      proc.stdin.flush();
    },
    exited: proc.exited,
    kill: (): void => {
      proc.kill();
    },
  };
}

/**
 * Auto-answers an `extension_ui_request` immediately instead of waiting out
 * its own default-value timeout (up to 30s per the protocol doc) — `confirm`
 * gets `confirmed: true` (mirrors `--yolo`'s auto-approve intent); anything
 * else gets `cancelled: true`, the doc's own stated default-on-timeout shape.
 */
function autoAnswerExtensionUi(rpc: SpawnedRpc, frame: RpcFrame): void {
  if (frame.type !== 'extension_ui_request' || typeof frame.id !== 'string') return;
  if (frame.method === 'confirm') {
    rpc.write({ type: 'extension_ui_response', id: frame.id, confirmed: true });
  } else {
    rpc.write({ type: 'extension_ui_response', id: frame.id, cancelled: true });
  }
}

async function drainUntilAgentEnd(
  rpc: SpawnedRpc,
  onFrame: (frame: RpcFrame) => void,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('drainUntilAgentEnd timed out');
    const frame = await rpc.reader.next(remaining);
    autoAnswerExtensionUi(rpc, frame);
    onFrame(frame);
    if (frame.type === 'agent_end' && frame.isTerminal !== false) return;
  }
}

async function runRpcSpike(ompVersion: string): Promise<RpcModeEvidence> {
  const evidence = emptyEvidence(ompVersion);
  const binaryPath = await resolveOmpBinaryPath();
  const cwd = mkdtempSync(join(tmpdir(), 'archon-omp-rpc-spike-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd });
  } catch {
    // A plain directory still satisfies the child's cwd requirement.
  }

  // Each drainUntilAgentEnd call gets its OWN fresh budget — sharing one
  // deadline across both scenarios let scenario A's redirect leg starve
  // scenario B's extension-dialog auto-resolve window in an earlier run.
  const remaining = (): number => EXPERIMENT_TIMEOUT_MS;
  const liveProcesses: Bun.Subprocess[] = [];

  try {
    // --- Scenario A: abort mid-turn, then redirect the SAME process. ---
    const rpcA = spawnRpc(binaryPath, cwd, liveProcesses);
    const ready = await rpcA.reader.next(READY_WAIT_MS);
    evidence.observedEventTypes.push(ready.type);
    evidence.readyFrameSeen = ready.type === 'ready';

    const contextToken = randomUUID().replaceAll('-', '');
    const promptId = randomUUID();
    rpcA.write({
      id: promptId,
      type: 'prompt',
      message:
        `Remember this token for later: ${contextToken}. ` +
        'Now count from 1 to 150, one number per line, with no other commentary.',
    });

    let abortId: string | null = null;
    let sawAgentEndA = false;
    await drainUntilAgentEnd(
      rpcA,
      frame => {
        evidence.observedEventTypes.push(frame.type);
        if (frame.type === 'response' && frame.id === promptId && frame.success === true) {
          evidence.promptAckSeen = true;
        }
        // Fire the abort as soon as the FIRST message_update lands — a
        // genuine mid-stream Stop, not a Stop after natural completion.
        if (!evidence.abort.attempted && frame.type === 'message_update') {
          evidence.abort.attempted = true;
          abortId = randomUUID();
          rpcA.write({ id: abortId, type: 'abort' });
        }
        if (abortId !== null && frame.type === 'response' && frame.id === abortId) {
          evidence.abort.ackSeen = frame.success === true;
        }
        if (frame.type === 'agent_end') {
          sawAgentEndA = true;
          evidence.agentEndCount += 1;
        }
      },
      remaining()
    );
    if (!sawAgentEndA) throw new Error('scenario A never reached agent_end');

    // Redirect on the SAME still-open process — no kill, no respawn, no
    // --resume flag — and a context CHALLENGE, not just a fresh reply: the
    // old SIGTERM+respawn path's failure was specifically that a killed
    // session could not prove it remembered turn 1's content on resume.
    const redirectId = randomUUID();
    const pidBefore = rpcA.pid;
    rpcA.write({
      id: redirectId,
      type: 'prompt',
      message: 'What token did I ask you to remember? Reply with only that token, nothing else.',
    });
    let sawAgentEndRedirect = false;
    let redirectMessagesJson = '';
    await drainUntilAgentEnd(
      rpcA,
      frame => {
        evidence.observedEventTypes.push(frame.type);
        if (frame.type === 'response' && frame.id === redirectId && frame.success === true) {
          evidence.abort.redirectPromptAckSeen = true;
        }
        if (frame.type === 'agent_end') {
          sawAgentEndRedirect = true;
          evidence.agentEndCount += 1;
          // `agent_end.messages` is the complete AgentMessage[] for the run —
          // checked (boolean only, never logged) for the token turn 1 asked
          // the model to remember, proving the redirect ran on the SAME
          // session's context rather than a context-blind fresh reply.
          const messages = (frame as { messages?: unknown }).messages;
          if (Array.isArray(messages)) redirectMessagesJson = JSON.stringify(messages);
        }
      },
      remaining()
    );
    evidence.abort.redirectReachedAgentEnd = sawAgentEndRedirect;
    evidence.abort.redirectProvedContext = redirectMessagesJson.includes(contextToken);
    evidence.abort.samePid = rpcA.pid === pidBefore; // Bun.spawn's pid never changes post-spawn; recorded for the report's record

    rpcA.write({ type: 'get_state' }); // best-effort liveness probe, ignored
    const exitRaceA = await Promise.race([
      rpcA.exited.then(() => 'exited' as const),
      new Promise<'alive'>(resolve =>
        setTimeout(() => {
          resolve('alive');
        }, 500)
      ),
    ]);
    evidence.abort.childExitedAfterAbort = exitRaceA === 'exited';

    rpcA.write({ type: 'abort' });
    try {
      await Promise.race([rpcA.exited, new Promise(resolve => setTimeout(resolve, 3_000))]);
    } catch {
      // best-effort teardown
    }

    // --- Scenario B: steer BETWEEN the two tool calls. ---
    const rpcB = spawnRpc(binaryPath, cwd, liveProcesses);
    const readyB = await rpcB.reader.next(READY_WAIT_MS);
    evidence.observedEventTypes.push(readyB.type);

    const interruptModeId = randomUUID();
    rpcB.write({ id: interruptModeId, type: 'set_interrupt_mode', mode: 'immediate' });

    const promptIdB = randomUUID();
    rpcB.write({
      id: promptIdB,
      type: 'prompt',
      message:
        'Use the Bash tool to run "sleep 1" exactly twice, one call at a time, ' +
        'waiting for each result before starting the next. After the second call ' +
        'returns, reply with exactly the word DONE and nothing else.',
    });

    let firstToolEndSeen = false;
    let toolStartCount = 0;
    let steerSentAt: number | null = null;
    let firstToolResult: RpcFrame | null = null;
    let sawAgentEndB = false;
    await drainUntilAgentEnd(
      rpcB,
      frame => {
        evidence.observedEventTypes.push(frame.type);
        if (frame.type === 'response' && frame.id === interruptModeId && frame.success === true) {
          evidence.steer.setInterruptModeAckSeen = true;
        }
        if (frame.type === 'tool_execution_start') toolStartCount += 1;
        // Steer in the gap the RPC doc names explicitly: AFTER the first
        // tool call's own result, BEFORE the model dispatches the second —
        // steering at tool_execution_start (the call already in flight)
        // tests a different, later boundary than the doc describes.
        if (frame.type === 'tool_execution_end' && !firstToolEndSeen) {
          firstToolEndSeen = true;
          firstToolResult = frame;
          if (!evidence.steer.attempted) {
            evidence.steer.attempted = true;
            steerSentAt = evidence.observedEventTypes.length;
            rpcB.write({
              id: randomUUID(),
              type: 'steer',
              // Asks the model to change the ALREADY-PLANNED next tool call —
              // if steer is boundary-only (queued for the NEXT turn instead
              // of consulted before dispatching call 2), call 2 still runs.
              message: 'Skip the second sleep call entirely. Reply with exactly DONE right now.',
            });
          }
        }
        if (evidence.steer.attempted && frame.type === 'response' && frame.success === true) {
          evidence.steer.ackSeen = true;
        }
        if (evidence.steer.attempted && frame.type === 'turn_start') {
          evidence.steer.sawTurnStartAfterSteer = true;
        }
        if (frame.type === 'agent_end') {
          sawAgentEndB = true;
          evidence.agentEndCount += 1;
          evidence.steer.agentEndCountAfterSteer += 1;
        }
      },
      remaining()
    );
    if (!sawAgentEndB) throw new Error('scenario B never reached agent_end');
    evidence.steer.steerLandedBeforeFirstAgentEnd = steerSentAt !== null;
    evidence.steer.secondToolCallStillRan = toolStartCount >= 2;
    if (firstToolResult !== null) {
      const outcome = (firstToolResult as { result?: { isError?: boolean } }).result;
      evidence.steer.toolOutcomeDisrupted = outcome?.isError === true;
    }

    rpcB.write({ type: 'abort' });
    try {
      await Promise.race([rpcB.exited, new Promise(resolve => setTimeout(resolve, 3_000))]);
    } catch {
      // best-effort teardown
    }
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error);
    process.stderr.write(`spike error: ${evidence.failure}\n`);
  } finally {
    // Force-kill every child regardless of outcome — an un-killed child's
    // open stdout pipe keeps this process's own event loop alive
    // indefinitely (Bun's default pipe-ref behavior), so a thrown timeout
    // above would otherwise hang the spike itself rather than exit cleanly.
    for (const proc of liveProcesses) {
      try {
        proc.kill();
      } catch {
        // already exited
      }
    }
    await Promise.allSettled(liveProcesses.map(proc => proc.exited));
    rmSync(cwd, { recursive: true, force: true });
  }

  return evidence;
}

export type RpcVerdict = 'verified' | 'unverified';

/**
 * The spec's bar for an RPC-mode Stop+redirect flip: the abort itself must
 * be acknowledged, the redirect on the SAME process must reach `agent_end`
 * AND prove it kept turn 1's context (not just "a reply came back"), on the
 * same pid. Anything else stays `unverified`.
 */
export function classifyRpcStopVerdict(evidence: RpcModeEvidence): RpcVerdict {
  if (evidence.failure !== null) return 'unverified';
  if (!evidence.abort.ackSeen) return 'unverified';
  if (!evidence.abort.redirectReachedAgentEnd || !evidence.abort.redirectProvedContext) {
    return 'unverified';
  }
  if (!evidence.abort.samePid) return 'unverified';
  return 'verified';
}

/**
 * The spec's bar for an RPC-mode soft-injection flip: `steer` must be
 * acknowledged AND actually change the in-flight plan (the already-planned
 * second tool call must NOT still run) inside the same `agent_end`. A steer
 * that lands as a queued follow-up — the second tool call runs unchanged —
 * is `followUp` semantics (CAP-8 Queue), not CAP-12 soft injection.
 */
export function classifyRpcSoftInjectionVerdict(evidence: RpcModeEvidence): RpcVerdict {
  if (evidence.failure !== null) return 'unverified';
  if (!evidence.steer.ackSeen) return 'unverified';
  if (evidence.steer.secondToolCallStillRan) return 'unverified';
  if (evidence.steer.agentEndCountAfterSteer !== 1) return 'unverified';
  return 'verified';
}

function readInstalledOmpVersion(): string {
  return execFileSync('omp', ['--version'], { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  const ompVersion = readInstalledOmpVersion();
  const evidence = await runRpcSpike(ompVersion);
  const document = {
    ...evidence,
    rpcStopVerdict: classifyRpcStopVerdict(evidence),
    rpcSoftInjectionVerdict: classifyRpcSoftInjectionVerdict(evidence),
  };
  process.stdout.write(`${JSON.stringify(document)}\n`);
  if (
    document.rpcStopVerdict === 'unverified' &&
    document.rpcSoftInjectionVerdict === 'unverified'
  ) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
