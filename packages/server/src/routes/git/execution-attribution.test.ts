import { describe, expect, test } from 'bun:test';
import type { ChangedFile } from '@archon/git';
import type { WorkflowNodeExecutionEvidence } from '@archon/workflows/store';

import { computeFileAttribution, selectRunBaselineCommit } from './execution-attribution';

function makeEvidence(
  overrides: Partial<WorkflowNodeExecutionEvidence> & { id: string; node_id: string }
): WorkflowNodeExecutionEvidence {
  return {
    workflow_run_id: 'run-1',
    retry_epoch: 0,
    start_checkpoint_ref: `refs/archon/evidence/run-1/${overrides.id}/start`,
    start_commit_sha: `${overrides.id}-start`,
    started_at: '2026-01-01T00:00:00.000Z',
    end_checkpoint_ref: `refs/archon/evidence/run-1/${overrides.id}/end`,
    end_commit_sha: `${overrides.id}-end`,
    ended_at: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

function stubDiff(
  table: Record<string, ChangedFile[]>
): (from: string, to: string) => Promise<readonly ChangedFile[]> {
  return async (from, to) => table[`${from}..${to}`] ?? [];
}

/** Every commit sha counts as an ancestor of HEAD unless explicitly listed as reset away. */
function stubAncestry(resetAway: readonly string[] = []): (commitSha: string) => Promise<boolean> {
  const excluded = new Set(resetAway);
  return async commitSha => !excluded.has(commitSha);
}

describe('computeFileAttribution', () => {
  test('attributes a single execution that proved a path change', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'build',
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:05.000Z',
      }),
    ];
    const diff = stubDiff({
      'exec-1-start..exec-1-end': [{ path: 'src/a.ts', status: 'M' }],
    });

    const result = await computeFileAttribution({
      files: [{ path: 'src/a.ts', status: 'M' }],
      evidence,
      diffCommitRange: diff,
      isAncestorOfHead: stubAncestry(),
    });

    expect(result).toEqual([
      {
        path: 'src/a.ts',
        status: 'M',
        executions: [
          {
            nodeId: 'build',
            retryEpoch: 0,
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: '2026-01-01T00:00:05.000Z',
          },
        ],
      },
    ]);
  });

  test('lists every proven execution in stable chronological order when a path changes across several', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'first',
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:01.000Z',
      }),
      makeEvidence({
        id: 'exec-2',
        node_id: 'second',
        started_at: '2026-01-01T00:00:02.000Z',
        ended_at: '2026-01-01T00:00:03.000Z',
      }),
    ];
    const diff = stubDiff({
      'exec-1-start..exec-1-end': [{ path: 'src/shared.ts', status: 'M' }],
      'exec-2-start..exec-2-end': [{ path: 'src/shared.ts', status: 'M' }],
    });

    const result = await computeFileAttribution({
      files: [{ path: 'src/shared.ts', status: 'M' }],
      evidence,
      diffCommitRange: diff,
      isAncestorOfHead: stubAncestry(),
    });

    expect(result[0]?.executions.map(e => e.nodeId)).toEqual(['first', 'second']);
  });

  test('reports unknown for paths whose changing execution has no end evidence', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'still-running',
        end_checkpoint_ref: null,
        end_commit_sha: null,
        ended_at: null,
      }),
    ];

    const result = await computeFileAttribution({
      files: [{ path: 'src/mystery.ts', status: 'M' }],
      evidence,
      diffCommitRange: stubDiff({}),
      isAncestorOfHead: stubAncestry(),
    });

    expect(result).toEqual([{ path: 'src/mystery.ts', status: 'M', executions: [] }]);
  });

  test('reports unknown for a changed path no evidence row explains at all', async () => {
    const result = await computeFileAttribution({
      files: [{ path: 'src/outside.ts', status: 'A' }],
      evidence: [],
      diffCommitRange: stubDiff({}),
      isAncestorOfHead: stubAncestry(),
    });

    expect(result).toEqual([{ path: 'src/outside.ts', status: 'A', executions: [] }]);
  });

  test('treats overlapping executions on the shared checkout as ambiguous — unknown for both', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'concurrent-a',
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:10.000Z',
      }),
      makeEvidence({
        id: 'exec-2',
        node_id: 'concurrent-b',
        // starts before exec-1 ends: the two ranges overlap
        started_at: '2026-01-01T00:00:05.000Z',
        ended_at: '2026-01-01T00:00:15.000Z',
      }),
    ];
    const diff = stubDiff({
      'exec-1-start..exec-1-end': [{ path: 'src/racy.ts', status: 'M' }],
      'exec-2-start..exec-2-end': [{ path: 'src/racy.ts', status: 'M' }],
    });

    const result = await computeFileAttribution({
      files: [{ path: 'src/racy.ts', status: 'M' }],
      evidence,
      diffCommitRange: diff,
      isAncestorOfHead: stubAncestry(),
    });

    expect(result).toEqual([{ path: 'src/racy.ts', status: 'M', executions: [] }]);
  });

  test('a third, non-overlapping execution keeps its own confident attribution despite an unrelated overlap', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'concurrent-a',
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:10.000Z',
      }),
      makeEvidence({
        id: 'exec-2',
        node_id: 'concurrent-b',
        started_at: '2026-01-01T00:00:05.000Z',
        ended_at: '2026-01-01T00:00:15.000Z',
      }),
      makeEvidence({
        id: 'exec-3',
        node_id: 'sequential-c',
        started_at: '2026-01-01T00:00:20.000Z',
        ended_at: '2026-01-01T00:00:25.000Z',
      }),
    ];
    const diff = stubDiff({
      'exec-1-start..exec-1-end': [{ path: 'src/racy.ts', status: 'M' }],
      'exec-2-start..exec-2-end': [{ path: 'src/racy.ts', status: 'M' }],
      'exec-3-start..exec-3-end': [{ path: 'src/clean.ts', status: 'A' }],
    });

    const result = await computeFileAttribution({
      files: [
        { path: 'src/clean.ts', status: 'A' },
        { path: 'src/racy.ts', status: 'M' },
      ],
      evidence,
      diffCommitRange: diff,
      isAncestorOfHead: stubAncestry(),
    });

    expect(result).toEqual([
      {
        path: 'src/clean.ts',
        status: 'A',
        executions: [
          {
            nodeId: 'sequential-c',
            retryEpoch: 0,
            startedAt: '2026-01-01T00:00:20.000Z',
            endedAt: '2026-01-01T00:00:25.000Z',
          },
        ],
      },
      { path: 'src/racy.ts', status: 'M', executions: [] },
    ]);
  });

  test('a checkpoint-strategy retry excludes the reset-away attempt, proven by ancestry rather than epoch', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'build',
        retry_epoch: 0,
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:01.000Z',
      }),
      makeEvidence({
        id: 'exec-2',
        node_id: 'build',
        retry_epoch: 1,
        started_at: '2026-01-02T00:00:00.000Z',
        ended_at: '2026-01-02T00:00:01.000Z',
      }),
    ];
    const diff = stubDiff({
      'exec-1-start..exec-1-end': [{ path: 'src/reverted.ts', status: 'M' }],
      'exec-2-start..exec-2-end': [{ path: 'src/kept.ts', status: 'M' }],
    });

    const result = await computeFileAttribution({
      files: [
        { path: 'src/kept.ts', status: 'M' },
        { path: 'src/reverted.ts', status: 'M' },
      ],
      evidence,
      diffCommitRange: diff,
      // The checkpoint reset that started epoch 1 discarded exec-1's commits —
      // its end commit is no longer reachable from HEAD.
      isAncestorOfHead: stubAncestry(['exec-1-end']),
    });

    expect(result).toEqual([
      {
        path: 'src/kept.ts',
        status: 'M',
        executions: [
          {
            nodeId: 'build',
            retryEpoch: 1,
            startedAt: '2026-01-02T00:00:00.000Z',
            endedAt: '2026-01-02T00:00:01.000Z',
          },
        ],
      },
      { path: 'src/reverted.ts', status: 'M', executions: [] },
    ]);
  });

  test('a current-strategy retry keeps the earlier attempt attributed alongside the retry', async () => {
    // checkoutStrategy: 'current' never resets the checkout, so exec-1's
    // commits stay exactly where they were — both attempts remain provable.
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'edit-a',
        retry_epoch: 0,
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:01.000Z',
      }),
      makeEvidence({
        id: 'exec-2',
        node_id: 'edit-b',
        retry_epoch: 1,
        started_at: '2026-01-01T00:00:02.000Z',
        ended_at: '2026-01-01T00:00:03.000Z',
      }),
    ];
    const diff = stubDiff({
      'exec-1-start..exec-1-end': [{ path: 'notes.md', status: 'M' }],
      'exec-2-start..exec-2-end': [{ path: 'notes.md', status: 'M' }],
    });

    const result = await computeFileAttribution({
      files: [{ path: 'notes.md', status: 'M' }],
      evidence,
      diffCommitRange: diff,
      isAncestorOfHead: stubAncestry(),
    });

    expect(result).toEqual([
      {
        path: 'notes.md',
        status: 'M',
        executions: [
          {
            nodeId: 'edit-a',
            retryEpoch: 0,
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: '2026-01-01T00:00:01.000Z',
          },
          {
            nodeId: 'edit-b',
            retryEpoch: 1,
            startedAt: '2026-01-01T00:00:02.000Z',
            endedAt: '2026-01-01T00:00:03.000Z',
          },
        ],
      },
    ]);
  });

  test('a node executed twice within the same epoch (e.g. a loop body) keeps both as distinct executions', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'loop-body',
        retry_epoch: 0,
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:01.000Z',
      }),
      makeEvidence({
        id: 'exec-2',
        node_id: 'loop-body',
        retry_epoch: 0,
        started_at: '2026-01-01T00:00:02.000Z',
        ended_at: '2026-01-01T00:00:03.000Z',
      }),
    ];
    const diff = stubDiff({
      'exec-1-start..exec-1-end': [{ path: 'src/iteration.ts', status: 'M' }],
      'exec-2-start..exec-2-end': [{ path: 'src/iteration.ts', status: 'M' }],
    });

    const result = await computeFileAttribution({
      files: [{ path: 'src/iteration.ts', status: 'M' }],
      evidence,
      diffCommitRange: diff,
      isAncestorOfHead: stubAncestry(),
    });

    expect(result[0]?.executions).toHaveLength(2);
    expect(result[0]?.executions.map(e => e.startedAt)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:02.000Z',
    ]);
  });

  test('returns an empty list when the run has no changed files', async () => {
    const result = await computeFileAttribution({
      files: [],
      evidence: [],
      diffCommitRange: stubDiff({}),
      isAncestorOfHead: stubAncestry(),
    });

    expect(result).toEqual([]);
  });
});

describe('selectRunBaselineCommit', () => {
  test('returns undefined when the run has no evidence at all', async () => {
    expect(await selectRunBaselineCommit([], stubAncestry())).toBeUndefined();
  });

  test('picks the earliest execution start commit as the baseline', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-2',
        node_id: 'second',
        started_at: '2026-01-01T00:00:05.000Z',
      }),
      makeEvidence({
        id: 'exec-1',
        node_id: 'first',
        started_at: '2026-01-01T00:00:00.000Z',
      }),
    ];

    expect(await selectRunBaselineCommit(evidence, stubAncestry())).toBe('exec-1-start');
  });

  test('ignores a retried attempt whose start commit was reset away', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'build',
        retry_epoch: 0,
        started_at: '2026-01-01T00:00:00.000Z',
      }),
      makeEvidence({
        id: 'exec-2',
        node_id: 'build',
        retry_epoch: 1,
        started_at: '2026-01-02T00:00:00.000Z',
      }),
    ];

    // Only the retried node's newest epoch remains an ancestor of HEAD, so
    // the baseline must come from exec-2, not the earlier, reset-away exec-1.
    expect(await selectRunBaselineCommit(evidence, stubAncestry(['exec-1-start']))).toBe(
      'exec-2-start'
    );
  });

  test('a current-strategy retry keeps the earlier attempt as the baseline', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'edit-a',
        retry_epoch: 0,
        started_at: '2026-01-01T00:00:00.000Z',
      }),
      makeEvidence({
        id: 'exec-2',
        node_id: 'edit-b',
        retry_epoch: 1,
        started_at: '2026-01-01T00:00:05.000Z',
      }),
    ];

    // Nothing was reset away, so the earliest execution overall still wins.
    expect(await selectRunBaselineCommit(evidence, stubAncestry())).toBe('exec-1-start');
  });

  test('still uses a still-open execution as the earliest boundary', async () => {
    const evidence = [
      makeEvidence({
        id: 'exec-1',
        node_id: 'still-running',
        started_at: '2026-01-01T00:00:00.000Z',
        end_checkpoint_ref: null,
        end_commit_sha: null,
        ended_at: null,
      }),
    ];

    expect(await selectRunBaselineCommit(evidence, stubAncestry())).toBe('exec-1-start');
  });
});
