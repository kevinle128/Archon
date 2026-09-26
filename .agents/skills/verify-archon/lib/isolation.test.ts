import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evidenceDirectory, git, loadCatalog, readJson, writeJson, TOOLING_REPO } from './io';
import { command, isolatedEnvironment } from './cli-scenarios';
import { prove } from './runner';

async function commit(repo: string): Promise<void> {
  await git(repo, ['add', '.']);
  await git(repo, ['-c', 'user.name=Verifier Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: checkpoint']);
}

test('public selector handoff survives a workflow checkpoint and local edits', async (): Promise<void> => {
  const repo = await mkdtemp(join(tmpdir(), 'archon-verifier-handoff-'));
  try {
    await git(repo, ['init', '-q']);
    await writeFile(join(repo, 'source.ts'), 'export {};\n');
    await commit(repo);
    const head = await git(repo, ['rev-parse', 'HEAD']);
    const attempt = join(repo, '.plans/verifications/handoff/attempt');
    const proposal = join(attempt, 'proposal.json');
    const selection = join(attempt, 'selection.json');
    await writeJson(proposal, {
      version: 1,
      // Old metadata remains readable, but cannot invalidate a user-path selection.
      base_sha: head, head_sha: head, changed_paths: ['source.ts'],
      affected_behaviors: [{ id: 'install.health', confidence: 'high', rationale: 'CLI discovery' }],
      coverage_gaps: [],
    });
    const helper = join(TOOLING_REPO, '.agents/skills/verify-archon/bin/verify.ts');
    const selected = await command(['bun', helper, 'normalize-selection', proposal, '--repo', repo, '--out', selection], repo, isolatedEnvironment(repo));
    expect(selected.exit).toBe(0);
    await commit(repo);
    expect(await git(repo, ['rev-parse', 'HEAD'])).not.toBe(head);
    await writeFile(join(repo, 'source.ts'), 'export const local = true;\n');
    await writeFile(join(repo, 'verification-notes.md'), 'Targets selected.\n');
    const validated = await command(['bun', helper, 'validate-selection', selection, '--repo', repo], repo, isolatedEnvironment(repo));
    expect(validated.exit).toBe(0);
    expect(JSON.parse(validated.stdout).scenario_ids).toEqual(['install.health']);
    expect(await readFile(join(repo, 'source.ts'), 'utf8')).toContain('local = true');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}, 30_000);

test('failed preflights retain evidence and preserve local work', async (): Promise<void> => {
  const repo = await mkdtemp(join(tmpdir(), 'archon-verifier-isolation-'));
  try {
    await git(repo, ['init', '-q']);
    await writeFile(join(repo, 'source.ts'), 'export {};\n');
    await commit(repo);
    const root = join(repo, '.plans/verifications/isolation/attempt/evidence');
    const first = await evidenceDirectory(repo, root);
    await writeFile(join(first, 'retained.txt'), 'evidence');
    expect(await evidenceDirectory(repo, root)).not.toBe(first);
    await writeFile(join(repo, 'source.ts'), 'export const changed = true;\n');
    await expect(evidenceDirectory(repo, join(repo, 'source-evidence'))).rejects.toThrow();
    await expect(evidenceDirectory(repo, join(TOOLING_REPO, 'packages/proof-output'))).rejects.toThrow();
    await mkdir(join(repo, '.plans/verifications/escape'), { recursive: true });
    await symlink(repo, join(repo, '.plans/verifications/escape/source'));
    await expect(evidenceDirectory(repo, join(repo, '.plans/verifications/escape/source/out'))).rejects.toThrow();
    const result = await prove(await loadCatalog(), repo, ['install.health'], root);
    expect(result.ok).toBe(false);
    expect(await readJson(join(result.evidence_dir, 'result.json'))).toEqual(result);
    expect(await readFile(join(first, 'retained.txt'), 'utf8')).toBe('evidence');
    expect(await readFile(join(repo, 'source.ts'), 'utf8')).toContain('changed = true');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}, 30_000);
