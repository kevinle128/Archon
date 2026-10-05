/**
 * Codex-specific half of the process-tree reap: identifying WHICH pid is
 * this attempt's own `codex exec` process. Snapshotting, descendant
 * collection, and the actual reap are provider-neutral and live in
 * `../shared/process-tree-reap.ts`.
 *
 * The Codex SDK spawns `codex exec` without `detached`, so it shares this
 * process's process group — a group-wide signal would hit this server too,
 * and the SDK exposes no handle to the spawned child's pid. The only
 * ownership signal available is process ancestry: `codex exec` is a direct
 * child of this process, and any shell command it runs for a tool call is,
 * in turn, its own child.
 */
import type { ProcessSnapshotEntry } from '../shared/process-tree-reap';

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
