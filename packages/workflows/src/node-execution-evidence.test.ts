import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileAsync } from '@archon/git';

import { beginNodeExecutionEvidence, endNodeExecutionEvidence } from './node-execution-evidence';
import type { WorkflowDeps } from './deps';
import type {
  WorkflowNodeExecutionEvidence,
  WorkflowNodeExecutionEvidenceEndInput,
  WorkflowNodeExecutionEvidenceStartInput,
} from './store';

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd: repoPath });
  return result.stdout.trim();
}

async function initRepo(repoPath: string): Promise<void> {
  await mkdir(repoPath, { recursive: true });
  await runGit(repoPath, ['init']);
  await runGit(repoPath, ['config', 'core.autocrlf', 'false']);
  await runGit(repoPath, ['config', 'user.name', 'Archon Test']);
  await runGit(repoPath, ['config', 'user.email', 'archon-test@example.com']);
  await writeFile(join(repoPath, 'tracked.txt'), 'initial\n');
  await runGit(repoPath, ['add', 'tracked.txt']);
  await runGit(repoPath, ['commit', '-m', 'initial']);
}

/** In-memory stand-in for the store's execution-evidence rows. */
function createFakeEvidenceStore() {
  const rows = new Map<string, WorkflowNodeExecutionEvidence>();
  return {
    rows,
    startWorkflowNodeExecutionEvidence: async (
      data: WorkflowNodeExecutionEvidenceStartInput
    ): Promise<WorkflowNodeExecutionEvidence> => {
      const row: WorkflowNodeExecutionEvidence = {
        ...data,
        started_at: new Date().toISOString(),
        end_checkpoint_ref: null,
        end_commit_sha: null,
        ended_at: null,
      };
      rows.set(row.id, row);
      return row;
    },
    completeWorkflowNodeExecutionEvidence: async (
      data: WorkflowNodeExecutionEvidenceEndInput
    ): Promise<void> => {
      const row = rows.get(data.id);
      if (!row) throw new Error(`no evidence row for id ${data.id}`);
      row.end_checkpoint_ref = data.end_checkpoint_ref;
      row.end_commit_sha = data.end_commit_sha;
      row.ended_at = new Date().toISOString();
    },
  };
}

describe('node execution evidence capture', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'archon-node-execution-evidence-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('records start evidence and completes it at execution end', async () => {
    const repoPath = join(testDir, 'repo');
    await initRepo(repoPath);
    const store = createFakeEvidenceStore();
    const deps = { store } as unknown as WorkflowDeps;

    const evidenceId = await beginNodeExecutionEvidence({
      deps,
      cwd: repoPath,
      workflowRunId: 'run-1',
      nodeId: 'node-a',
      retryEpoch: 0,
    });
    expect(evidenceId).toBeDefined();
    const started = store.rows.get(evidenceId as string);
    expect(started?.end_commit_sha).toBeNull();

    await writeFile(join(repoPath, 'tracked.txt'), 'changed by node-a\n');
    await endNodeExecutionEvidence({
      deps,
      cwd: repoPath,
      workflowRunId: 'run-1',
      nodeId: 'node-a',
      evidenceId: evidenceId as string,
    });

    const completed = store.rows.get(evidenceId as string);
    expect(completed?.end_commit_sha).toBeTruthy();
    expect(completed?.end_commit_sha).not.toBe(completed?.start_commit_sha);
  }, 30_000);

  test('returns undefined without a git checkout, and end capture is a no-op', async () => {
    const nonGitDir = join(testDir, 'not-a-repo');
    await mkdir(nonGitDir, { recursive: true });
    const store = createFakeEvidenceStore();
    const deps = { store } as unknown as WorkflowDeps;

    const evidenceId = await beginNodeExecutionEvidence({
      deps,
      cwd: nonGitDir,
      workflowRunId: 'run-1',
      nodeId: 'node-a',
      retryEpoch: 0,
    });

    expect(evidenceId).toBeUndefined();
    expect(store.rows.size).toBe(0);
  });

  test('never throws when the store has no evidence methods wired', async () => {
    const repoPath = join(testDir, 'repo-no-store');
    await initRepo(repoPath);
    const deps = { store: {} } as unknown as WorkflowDeps;

    const evidenceId = await beginNodeExecutionEvidence({
      deps,
      cwd: repoPath,
      workflowRunId: 'run-1',
      nodeId: 'node-a',
      retryEpoch: 0,
    });
    expect(evidenceId).toBeUndefined();

    await expect(
      endNodeExecutionEvidence({
        deps,
        cwd: repoPath,
        workflowRunId: 'run-1',
        nodeId: 'node-a',
        evidenceId: 'does-not-matter',
      })
    ).resolves.toBeUndefined();
  });

  test('never throws when the end snapshot fails (e.g. the checkout vanished)', async () => {
    const repoPath = join(testDir, 'repo-vanish');
    await initRepo(repoPath);
    const store = createFakeEvidenceStore();
    const deps = { store } as unknown as WorkflowDeps;

    const evidenceId = await beginNodeExecutionEvidence({
      deps,
      cwd: repoPath,
      workflowRunId: 'run-1',
      nodeId: 'node-a',
      retryEpoch: 0,
    });
    expect(evidenceId).toBeDefined();

    await rm(repoPath, { recursive: true, force: true });

    await expect(
      endNodeExecutionEvidence({
        deps,
        cwd: repoPath,
        workflowRunId: 'run-1',
        nodeId: 'node-a',
        evidenceId: evidenceId as string,
      })
    ).resolves.toBeUndefined();
    expect(store.rows.get(evidenceId as string)?.end_commit_sha).toBeNull();
  }, 30_000);
});
