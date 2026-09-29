import { describe, test, expect, mock } from 'bun:test';
import { createMockLogger } from '../test/mocks/logger';

const mockLogger = createMockLogger();
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

import {
  collectDescendantPids,
  reapProcessTree,
  type ProcessSnapshotEntry,
  type ProcessTreeOps,
} from './process-tree-reap';

function tree(): ProcessSnapshotEntry[] {
  return [
    { pid: 9001, ppid: 4242, command: 'agent-cli --run task' },
    { pid: 9002, ppid: 9001, command: '/bin/zsh -c sleep 25 && echo step-1' },
    { pid: 9003, ppid: 9002, command: 'sleep 25' },
    // Unrelated process: not a descendant of the root at all.
    { pid: 500, ppid: 1, command: '/usr/sbin/some-daemon' },
  ];
}

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

describe('reapProcessTree', () => {
  // The root itself is never reaped by this function — the caller is
  // responsible for the root (which it either already killed, or knows is
  // already dead); only its snapshotted descendants are ever in
  // `descendantPids`.
  test('SIGTERMs a live descendant, no SIGKILL when it dies in the grace window', async () => {
    const ops = fakeOps([9002]);
    // The descendant dies promptly once SIGTERM'd — simulate that inside kill().
    const originalKill = ops.kill;
    const wrappedKill = (pid: number, signal: NodeJS.Signals): void => {
      originalKill(pid, signal);
      if (signal === 'SIGTERM') ops.alive.delete(pid);
    };
    await reapProcessTree({
      ops: { ...ops, kill: wrappedKill },
      descendantPids: [9002],
      terminateGraceMs: 20,
    });
    expect(ops.killed).toEqual([{ pid: 9002, signal: 'SIGTERM' }]);
  });

  test('escalates to SIGKILL when a descendant outlives the terminate grace window', async () => {
    const ops = fakeOps([9002]);
    await reapProcessTree({
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
    await reapProcessTree({
      ops,
      descendantPids: [9002],
      terminateGraceMs: 10,
    });
    expect(ops.killed).toEqual([]);
  });

  test('reaps every live descendant in a multi-pid snapshot', async () => {
    const ops = fakeOps([9002, 9003]);
    await reapProcessTree({
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
