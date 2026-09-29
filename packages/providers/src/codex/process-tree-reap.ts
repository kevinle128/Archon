/**
 * Best-effort process-tree reap for a Codex turn's spawned subprocess.
 *
 * The Codex SDK spawns `codex exec` without `detached`, so it shares this
 * process's process group — a group-wide signal would hit this server too,
 * and the SDK exposes no handle to the spawned child's pid. The only
 * ownership signal available is process ancestry: `codex exec` is a direct
 * child of this process, and any shell command it runs for a tool call is,
 * in turn, its own child. When the SDK's abort signal fires, Node kills only
 * the immediate `codex exec` child; a tool subprocess it already started
 * keeps running, reparented to init once `codex exec` exits. This module
 * snapshots that descendant tree by pid ancestry (via `ps`) and reaps
 * whatever outlives `codex exec`'s own exit.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '@archon/paths';

const execFileAsync = promisify(execFile);

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('provider.codex.process-tree-reap');
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

/**
 * Identify the single `codex exec` process this attempt spawned, among
 * direct children of `parentPid` (this process). Narrowed by the exact
 * `--cd <cwd>` this attempt passed and the `exec` subcommand token; further
 * narrowed by `resume <threadId>` when known, since a retry or a resumed
 * thread's invocation carries that token and a fresh thread's does not.
 *
 * Two Codex nodes racing in the SAME cwd within the SAME narrow window
 * cannot be told apart by this signal alone — returns `'ambiguous'` rather
 * than guessing, so a caller skips the reap instead of risking a wrong-target
 * kill. Archon isolates most workflow nodes into separate worktrees, so this
 * is expected to be rare in practice (a same-cwd retry racing a fresh sibling
 * node, or a shared, non-isolated checkout).
 */
export function findCodexExecRoot(
  processes: readonly ProcessSnapshotEntry[],
  params: { readonly parentPid: number; readonly cwd: string; readonly threadId: string | null }
): ProcessSnapshotEntry | 'ambiguous' | null {
  const cwdToken = `--cd ${params.cwd}`;
  let candidates = processes.filter(
    entry =>
      entry.ppid === params.parentPid &&
      /(^|\s)exec(\s|$)/.test(entry.command) &&
      entry.command.includes(cwdToken)
  );
  if (candidates.length > 1 && params.threadId !== null) {
    const resumeToken = `resume ${params.threadId}`;
    const narrowed = candidates.filter(entry => entry.command.includes(resumeToken));
    if (narrowed.length > 0) candidates = narrowed;
  }
  if (candidates.length === 0) return null;
  if (candidates.length > 1) return 'ambiguous';
  return candidates[0];
}

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
  /** Grace between SIGTERM and SIGKILL for a descendant that outlives `codex exec`. */
  readonly terminateGraceMs: number;
}

/**
 * Reap every still-alive pid from a snapshot taken while `codex exec` was
 * alive (see `CodexProvider.captureTreeSnapshot`). By the time this runs,
 * `codex exec` itself is always already dead — measured live, its death
 * from the SDK's own `spawn({ signal })` teardown is faster than a fresh
 * `ps` round-trip, so there is nothing to wait for here; only its orphaned
 * descendants (reparented to init) need reaping. SIGTERM then SIGKILL after
 * a grace window, matching the ACP providers' `reapChild` shape.
 */
export async function reapCodexProcessTree(options: ReapTreeOptions): Promise<void> {
  const { ops, descendantPids, terminateGraceMs } = options;
  const alive = descendantPids.filter(pid => ops.isAlive(pid));
  if (alive.length === 0) return;
  getLog().info({ pids: alive }, 'codex.tree_reap_terminating_orphans');
  for (const pid of alive) ops.kill(pid, 'SIGTERM');
  await waitMs(terminateGraceMs);
  const stillAlive = alive.filter(pid => ops.isAlive(pid));
  for (const pid of stillAlive) ops.kill(pid, 'SIGKILL');
  if (stillAlive.length > 0) {
    getLog().info({ pids: stillAlive }, 'codex.tree_reap_sigkilled_orphans');
  }
}
