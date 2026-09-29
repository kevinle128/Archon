import { describe, test, expect, mock } from 'bun:test';
import { createMockLogger } from '../test/mocks/logger';

const mockLogger = createMockLogger();
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

import {
  findCodexExecRoot,
  collectDescendantPids,
  reapCodexProcessTree,
  type ProcessSnapshotEntry,
  type ProcessTreeOps,
} from './process-tree-reap';

const OUR_PID = 4242;

function tree(overrides?: Partial<Record<string, ProcessSnapshotEntry>>): ProcessSnapshotEntry[] {
  const base: ProcessSnapshotEntry[] = [
    {
      pid: 9001,
      ppid: OUR_PID,
      command: 'codex exec --experimental-json --cd /workspace/proj',
    },
    { pid: 9002, ppid: 9001, command: '/bin/zsh -c sleep 25 && echo step-1' },
    { pid: 9003, ppid: 9002, command: 'sleep 25' },
    // Unrelated process: not a child of our pid at all.
    { pid: 500, ppid: 1, command: '/usr/sbin/some-daemon' },
  ];
  if (!overrides) return base;
  return base.map(entry => overrides[String(entry.pid)] ?? entry);
}

describe('findCodexExecRoot', () => {
  test('finds the exec process among direct children of our pid, by cwd', () => {
    const root = findCodexExecRoot(tree(), {
      parentPid: OUR_PID,
      cwd: '/workspace/proj',
      threadId: null,
    });
    expect(root).toMatchObject({ pid: 9001 });
  });

  test('returns null when no direct child matches the cwd', () => {
    const root = findCodexExecRoot(tree(), {
      parentPid: OUR_PID,
      cwd: '/workspace/other',
      threadId: null,
    });
    expect(root).toBeNull();
  });

  test('returns null for a child that is not an `exec` invocation', () => {
    const processes: ProcessSnapshotEntry[] = [
      { pid: 9001, ppid: OUR_PID, command: 'codex login --cd /workspace/proj' },
    ];
    const root = findCodexExecRoot(processes, {
      parentPid: OUR_PID,
      cwd: '/workspace/proj',
      threadId: null,
    });
    expect(root).toBeNull();
  });

  test('two same-cwd exec children with no known thread id are ambiguous', () => {
    const processes: ProcessSnapshotEntry[] = [
      { pid: 9001, ppid: OUR_PID, command: 'codex exec --experimental-json --cd /workspace/proj' },
      { pid: 9005, ppid: OUR_PID, command: 'codex exec --experimental-json --cd /workspace/proj' },
    ];
    const root = findCodexExecRoot(processes, {
      parentPid: OUR_PID,
      cwd: '/workspace/proj',
      threadId: null,
    });
    expect(root).toBe('ambiguous');
  });

  test('a known thread id narrows two same-cwd candidates down to the resumed one', () => {
    const processes: ProcessSnapshotEntry[] = [
      {
        pid: 9001,
        ppid: OUR_PID,
        command: 'codex exec --experimental-json --cd /workspace/proj resume thread-abc',
      },
      { pid: 9005, ppid: OUR_PID, command: 'codex exec --experimental-json --cd /workspace/proj' },
    ];
    const root = findCodexExecRoot(processes, {
      parentPid: OUR_PID,
      cwd: '/workspace/proj',
      threadId: 'thread-abc',
    });
    expect(root).toMatchObject({ pid: 9001 });
  });

  test('a grandchild (not a direct child of our pid) is never mistaken for the root', () => {
    const processes: ProcessSnapshotEntry[] = [
      { pid: 100, ppid: 1, command: 'some-wrapper' },
      { pid: 9001, ppid: 100, command: 'codex exec --experimental-json --cd /workspace/proj' },
    ];
    const root = findCodexExecRoot(processes, {
      parentPid: OUR_PID,
      cwd: '/workspace/proj',
      threadId: null,
    });
    expect(root).toBeNull();
  });
});

describe('collectDescendantPids', () => {
  test('walks the full multi-level descendant subtree, excluding unrelated processes', () => {
    const descendants = collectDescendantPids(tree(), 9001);
    expect(new Set(descendants)).toEqual(new Set([9002, 9003]));
  });

  test('returns an empty list for a childless root', () => {
    const descendants = collectDescendantPids(tree(), 500);
    expect(descendants).toEqual([]);
  });
});

/** A fake process whose liveness the test controls directly, and whose kill calls are recorded. */
function fakeOps(initiallyAlive: readonly number[]): ProcessTreeOps & {
  alive: Set<number>;
  killed: { pid: number; signal: NodeJS.Signals }[];
} {
  const alive = new Set(initiallyAlive);
  const killed: { pid: number; signal: NodeJS.Signals }[] = [];
  return {
    alive,
    killed,
    listProcesses: () => Promise.resolve([]),
    isAlive: (pid: number) => alive.has(pid),
    kill: (pid: number, signal: NodeJS.Signals) => {
      killed.push({ pid, signal });
    },
  };
}

describe('reapCodexProcessTree', () => {
  // The root (`codex exec`) is never reaped by this function — by the time
  // it runs, `codex exec` is always already dead (its own SIGTERM teardown
  // is faster than any snapshot round-trip could observe it alive), so only
  // its snapshotted descendants are ever in `descendantPids`.
  test('SIGTERMs a live descendant, no SIGKILL when it dies in the grace window', async () => {
    const ops = fakeOps([9002]);
    // The descendant dies promptly once SIGTERM'd — simulate that inside kill().
    const originalKill = ops.kill;
    const wrappedKill = (pid: number, signal: NodeJS.Signals): void => {
      originalKill(pid, signal);
      if (signal === 'SIGTERM') ops.alive.delete(pid);
    };
    await reapCodexProcessTree({
      ops: { ...ops, kill: wrappedKill },
      descendantPids: [9002],
      terminateGraceMs: 20,
    });
    expect(ops.killed).toEqual([{ pid: 9002, signal: 'SIGTERM' }]);
  });

  test('escalates to SIGKILL when a descendant outlives the terminate grace window', async () => {
    const ops = fakeOps([9002]);
    await reapCodexProcessTree({
      ops,
      descendantPids: [9002],
      terminateGraceMs: 10,
    });
    expect(ops.killed).toEqual([
      { pid: 9002, signal: 'SIGTERM' },
      { pid: 9002, signal: 'SIGKILL' },
    ]);
  });

  test('never signals a descendant that already exited on its own', async () => {
    const ops = fakeOps([]);
    await reapCodexProcessTree({
      ops,
      descendantPids: [9002],
      terminateGraceMs: 10,
    });
    expect(ops.killed).toEqual([]);
  });

  test('reaps every live descendant in a multi-pid snapshot', async () => {
    const ops = fakeOps([9002, 9003]);
    await reapCodexProcessTree({
      ops,
      descendantPids: [9002, 9003],
      terminateGraceMs: 10,
    });
    expect(ops.killed).toEqual([
      { pid: 9002, signal: 'SIGTERM' },
      { pid: 9003, signal: 'SIGTERM' },
      { pid: 9002, signal: 'SIGKILL' },
      { pid: 9003, signal: 'SIGKILL' },
    ]);
  });
});
