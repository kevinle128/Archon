import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

interface MockLogger {
  fatal: ReturnType<typeof mock>;
  error: ReturnType<typeof mock>;
  warn: ReturnType<typeof mock>;
  info: ReturnType<typeof mock>;
  debug: ReturnType<typeof mock>;
  trace: ReturnType<typeof mock>;
  child: ReturnType<typeof mock>;
}

function createMockLogger(): MockLogger {
  const logger: MockLogger = {
    fatal: mock(() => undefined),
    error: mock(() => undefined),
    warn: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    child: mock(() => logger),
  };
  return logger;
}

mock.module('@archon/paths', () => ({
  createLogger: mock(() => createMockLogger()),
}));

import {
  buildExecutionEvidenceRef,
  captureExecutionEvidenceSnapshot,
  diffCommitRange,
} from './execution-evidence';
import { execFileAsync } from './exec';
import { verifyCommitRef } from './retry-refs';

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd: repoPath });
  return result.stdout.trim();
}

async function initRepo(repoPath: string): Promise<string> {
  await mkdir(repoPath, { recursive: true });
  await runGit(repoPath, ['init']);
  await runGit(repoPath, ['config', 'core.autocrlf', 'false']);
  await runGit(repoPath, ['config', 'user.name', 'Archon Test']);
  await runGit(repoPath, ['config', 'user.email', 'archon-test@example.com']);
  await writeFile(join(repoPath, 'tracked.txt'), 'initial\n');
  await runGit(repoPath, ['add', 'tracked.txt']);
  await runGit(repoPath, ['commit', '-m', 'initial']);
  return runGit(repoPath, ['rev-parse', '--verify', 'HEAD']);
}

describe('node execution git evidence', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'archon-execution-evidence-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('builds a ref namespaced by run, execution id, and boundary', () => {
    expect(
      buildExecutionEvidenceRef({ runId: 'run-1', executionId: 'exec-1', boundary: 'start' })
    ).toBe('refs/archon/evidence/run-1/exec-1/start');
    expect(
      buildExecutionEvidenceRef({ runId: 'run-1', executionId: 'exec-1', boundary: 'end' })
    ).toBe('refs/archon/evidence/run-1/exec-1/end');
  });

  test('captures a snapshot without creating a commit when the checkout is clean', async () => {
    const repoPath = join(testDir, 'clean');
    const initialSha = await initRepo(repoPath);

    const snapshot = await captureExecutionEvidenceSnapshot(
      repoPath,
      { runId: 'run-1', executionId: 'exec-1', boundary: 'start' },
      'archon evidence: start'
    );

    expect(snapshot).toEqual({
      ref: 'refs/archon/evidence/run-1/exec-1/start',
      commitSha: initialSha,
      createdCommit: false,
    });
    await expect(verifyCommitRef(repoPath, snapshot.ref)).resolves.toBe(initialSha);
  }, 30_000);

  test('two executions of the same node get independent refs that do not collide', async () => {
    const repoPath = join(testDir, 'repeat');
    await initRepo(repoPath);

    const first = await captureExecutionEvidenceSnapshot(
      repoPath,
      { runId: 'run-1', executionId: 'exec-1', boundary: 'start' },
      'archon evidence: exec-1 start'
    );
    await writeFile(join(repoPath, 'tracked.txt'), 'from exec 1\n');
    const firstEnd = await captureExecutionEvidenceSnapshot(
      repoPath,
      { runId: 'run-1', executionId: 'exec-1', boundary: 'end' },
      'archon evidence: exec-1 end'
    );

    await writeFile(join(repoPath, 'tracked.txt'), 'from exec 2\n');
    const second = await captureExecutionEvidenceSnapshot(
      repoPath,
      { runId: 'run-1', executionId: 'exec-2', boundary: 'start' },
      'archon evidence: exec-2 start'
    );

    // exec-1's own start ref still resolves to exec-1's own start commit —
    // a second execution of the same node never overwrote it.
    await expect(verifyCommitRef(repoPath, first.ref)).resolves.toBe(first.commitSha);
    await expect(verifyCommitRef(repoPath, firstEnd.ref)).resolves.toBe(firstEnd.commitSha);
    expect(second.ref).not.toBe(first.ref);
    expect(second.commitSha).not.toBe(firstEnd.commitSha);
  }, 30_000);

  test('diffs paths changed between two commits in deterministic order', async () => {
    const repoPath = join(testDir, 'diff');
    await initRepo(repoPath);

    const start = await captureExecutionEvidenceSnapshot(
      repoPath,
      { runId: 'run-1', executionId: 'exec-1', boundary: 'start' },
      'start'
    );
    await writeFile(join(repoPath, 'b.txt'), 'new\n');
    await writeFile(join(repoPath, 'a.txt'), 'new\n');
    await writeFile(join(repoPath, 'tracked.txt'), 'changed\n');
    const end = await captureExecutionEvidenceSnapshot(
      repoPath,
      { runId: 'run-1', executionId: 'exec-1', boundary: 'end' },
      'end'
    );

    const files = await diffCommitRange(repoPath, start.commitSha, end.commitSha);
    expect(files).toEqual([
      { path: 'a.txt', status: 'A' },
      { path: 'b.txt', status: 'A' },
      { path: 'tracked.txt', status: 'M' },
    ]);
  }, 30_000);

  test('returns no changes when the two commits are identical', async () => {
    const repoPath = join(testDir, 'no-op');
    const initialSha = await initRepo(repoPath);

    const files = await diffCommitRange(repoPath, initialSha, initialSha);
    expect(files).toEqual([]);
  });
});
