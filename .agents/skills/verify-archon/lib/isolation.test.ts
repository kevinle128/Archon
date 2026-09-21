import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evidenceDirectory, git, loadCatalog, readJson, resolveBase, snapshot, TOOLING_REPO } from './io';
import { prove } from './runner';

async function commitFile(repo: string, path: string, contents: string, message: string): Promise<string> {
  await writeFile(join(repo, path), contents);
  await git(repo, ['add', path]);
  await git(repo, ['-c', 'user.name=Verifier Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

test('default base is the merge-base with local develop', async (): Promise<void> => {
  const repo = await mkdtemp(join(tmpdir(), 'archon-verifier-develop-base-'));
  try {
    await git(repo, ['init', '-q']);
    await git(repo, ['checkout', '-q', '-b', 'develop']);
    await commitFile(repo, 'source.ts', 'export {};\n', 'test: develop root');
    const integration = await commitFile(repo, 'source.ts', 'export const develop = true;\n', 'test: develop tip');
    await git(repo, ['checkout', '-q', '-b', 'feature']);
    await commitFile(repo, 'source.ts', 'export const feature = true;\n', 'test: feature tip');
    expect(await resolveBase(repo)).toBe(integration);
    const current = await snapshot(repo);
    expect(current.base_sha).toBe(integration);
    expect(current.head_sha).not.toBe(integration);
    expect(current.changed_paths).toEqual(['source.ts']);
  } finally { await rm(repo, { recursive: true, force: true }); }
}, 15_000);

test('retained proof artifacts preserve clean source and failed preflights get fresh receipts', async (): Promise<void> => {
  const repo = await mkdtemp(join(tmpdir(), 'archon-verifier-isolation-'));
  try {
    await git(repo, ['init', '-q']);
    await writeFile(join(repo, 'source.ts'), 'export {};\n');
    await git(repo, ['add', 'source.ts']);
    await git(repo, ['-c', 'user.name=Verifier Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: disposable source']);
    const base = (await snapshot(repo)).head_sha;
    const root = join(repo, '.plans/verifications/isolation/attempt/evidence');
    const first = await evidenceDirectory(repo, root);
    await writeFile(join(first, 'retained.txt'), 'evidence');
    expect((await snapshot(repo, base)).dirty).toBe(false);
    const second = await evidenceDirectory(repo, root);
    expect(second).not.toBe(first);
    await writeFile(join(repo, 'unrelated.txt'), 'not an artifact');
    expect((await snapshot(repo, base)).dirty).toBe(true);
    await rm(join(repo, 'unrelated.txt'));
    await writeFile(join(repo, 'source.ts'), 'export const changed = true;\n');
    expect((await snapshot(repo, base)).dirty).toBe(true);
    await expect(evidenceDirectory(repo, join(repo, 'source-evidence'))).rejects.toThrow();
    await expect(evidenceDirectory(repo, join(TOOLING_REPO, 'packages/proof-output'))).rejects.toThrow();
    await mkdir(join(repo, '.plans/verifications/escape'), { recursive: true });
    await symlink(repo, join(repo, '.plans/verifications/escape/source'));
    await expect(evidenceDirectory(repo, join(repo, '.plans/verifications/escape/source/out'))).rejects.toThrow();
    const result = await prove(await loadCatalog(), repo, ['install.health'], root, undefined, base);
    expect(result.ok).toBe(false);
    expect(await readJson(join(result.evidence_dir, 'result.json'))).toEqual(result);
  } finally { await rm(repo, { recursive: true, force: true }); }
}, 30_000);
