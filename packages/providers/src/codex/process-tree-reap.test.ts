import { describe, test, expect } from 'bun:test';

import { findCodexExecRoot } from './process-tree-reap';
import type { ProcessSnapshotEntry } from '../shared/process-tree-reap';

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
