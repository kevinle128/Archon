/**
 * Provider-neutral process-tree reap for a subprocess a provider spawned
 * without a detached process group.
 *
 * A provider's own subprocess may fork further children for a tool call
 * (a shell command, a build step). When Archon aborts that subprocess (Stop,
 * Cancel, Abandon), the OS only signals the direct child — anything IT
 * already forked keeps running, reparented to init once the direct child
 * exits. The only ownership signal available is process ancestry: this
 * module snapshots the descendant tree by pid (via `ps`) and reaps whatever
 * outlives the direct child.
 *
 * Finding the ROOT pid to snapshot from is provider-specific (a provider
 * that hands back its own spawned pid, like Grok's `Bun.spawn`, can use it
 * directly; one that does not, like the Codex SDK, needs its own
 * ancestry-matching heuristic — see `codex/process-tree-reap.ts`'s
 * `findCodexExecRoot`). Everything below this line — snapshotting,
 * descendant collection, and the actual reap — is identical for every
 * provider and lives here so it is written, and tested, once.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '@archon/paths';

const execFileAsync = promisify(execFile);

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('provider.process-tree-reap');
  return cachedLog;
}

export interface ProcessSnapshotEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

export interface ProcessTreeOps {
  listProcesses(): Promise<readonly ProcessSnapshotEntry[]>;
  isAlive(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
}

// `ps -axo pid,ppid,command` prints a header row, then one row per process:
// leading-whitespace-padded pid, ppid, then the full (space-joined,
// unquoted) argv as the rest of the line.
const PS_ROW_PATTERN = /^\s*(\d+)\s+(\d+)\s+(.*)$/;

// child_process's own default (1 MB) is tight on a busy dev machine — a
// full `ps -axo pid,ppid,command` measured ~312 KB on one loaded box, and
// long argv (env-var dumps, shell wrapper scripts) can push a single
// snapshot well past that on a heavier one. A silent truncation here would
// surface only as a swallowed `tree_reap_snapshot_failed` warning.
const PS_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

async function listProcessesViaPs(): Promise<readonly ProcessSnapshotEntry[]> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid,ppid,command'], {
    maxBuffer: PS_MAX_BUFFER_BYTES,
  });
  const entries: ProcessSnapshotEntry[] = [];
  for (const line of stdout.split('\n').slice(1)) {
    const match = PS_ROW_PATTERN.exec(line);
    if (!match) continue;
    entries.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return entries;
}

function isAliveViaSignal(pid: number): boolean {
  try {
    // Signal 0 sends nothing; it only probes whether the pid is reachable.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killIgnoringMissing(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // ESRCH (already gone) or EPERM: nothing left to do in a best-effort reap.
  }
}

export const defaultProcessTreeOps: ProcessTreeOps = {
  listProcesses: listProcessesViaPs,
  isAlive: isAliveViaSignal,
  kill: killIgnoringMissing,
};

/** Every descendant of `rootPid` in the snapshot, by pid ancestry (BFS). */
export function collectDescendantPids(
  processes: readonly ProcessSnapshotEntry[],
  rootPid: number
): readonly number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const entry of processes) {
    const siblings = childrenByParent.get(entry.ppid);
    if (siblings) siblings.push(entry.pid);
    else childrenByParent.set(entry.ppid, [entry.pid]);
  }
  const result: number[] = [];
  // BFS via a growing array instead of shift(): a plain array's default
  // iterator re-reads `length` on every step, so pushing new pids onto
  // `queue` during the loop naturally visits them too.
  const queue: number[] = [rootPid];
  for (const pid of queue) {
    for (const childPid of childrenByParent.get(pid) ?? []) {
      result.push(childPid);
      queue.push(childPid);
    }
  }
  return result;
}

async function waitMs(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms));
}

export interface ReapTreeOptions {
  readonly ops: ProcessTreeOps;
  readonly descendantPids: readonly number[];
  /** Grace between SIGTERM and SIGKILL for a descendant that outlives the direct child. */
  readonly terminateGraceMs: number;
}

/**
 * Reap every still-alive pid from a snapshot taken while the provider's
 * direct child was alive. SIGTERM every descendant, wait `terminateGraceMs`,
 * then SIGKILL whatever is still alive.
 */
export async function reapProcessTree(options: ReapTreeOptions): Promise<void> {
  const { ops, descendantPids, terminateGraceMs } = options;
  const alive = descendantPids.filter(pid => ops.isAlive(pid));
  if (alive.length === 0) return;
  getLog().info({ pids: alive }, 'process_tree_reap.terminating_orphans');
  for (const pid of alive) ops.kill(pid, 'SIGTERM');
  await waitMs(terminateGraceMs);
  const stillAlive = alive.filter(pid => ops.isAlive(pid));
  for (const pid of stillAlive) ops.kill(pid, 'SIGKILL');
  if (stillAlive.length > 0) {
    getLog().info({ pids: stillAlive }, 'process_tree_reap.sigkilled_orphans');
  }
}
