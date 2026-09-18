import { afterEach, beforeEach, expect, test } from 'bun:test';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import visualConfig from '../.agents/skills/verify-archon/visual-config.json';
import {
  beginAttempt,
  prepareAttempt,
  normalizeAttempt,
  recordAttempt,
  assertPass,
} from '../.archon/scripts/verify-feature-gate';
import { digest, normalizeProposal } from '../.agents/skills/verify-archon/lib/contract';
import {
  git,
  loadCatalog,
  readJson,
  snapshot,
  toolingDigest,
  writeJson,
  TOOLING_REPO,
} from '../.agents/skills/verify-archon/lib/io';

let dir: string;
let repo: string;
let artifacts: string;
let attempt: string;
let attemptId: string;
let proofPath: string;
let baseSha: string;

beforeEach(async (): Promise<void> => {
  dir = await mkdtemp(join(tmpdir(), 'archon-workflow-gate-'));
  repo = join(dir, 'repo');
  artifacts = join(dir, 'artifacts');
  await mkdir(repo);
  await git(repo, ['init', '-q']);
  await git(repo, [
    '-c',
    'user.name=Gate Test',
    '-c',
    'user.email=gate@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-qm',
    'fixture',
  ]);
  baseSha = (await snapshot(repo)).head_sha;
  await mkdir(join(repo, 'packages/cli/src/commands'), { recursive: true });
  await writeFile(join(repo, 'packages/cli/src/commands/doctor.ts'), 'export const state = 1;\n');
  await git(repo, ['add', '.']);
  await git(repo, [
    '-c',
    'user.name=Gate Test',
    '-c',
    'user.email=gate@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'fixture change',
  ]);
  const current = await snapshot(repo, baseSha);
  await mkdir(join(artifacts, 'superpowers'), { recursive: true });
  await writeFile(join(artifacts, 'superpowers/base-sha.txt'), baseSha);
  attemptId = await beginAttempt(repo, artifacts);
  await prepareAttempt(repo, artifacts);
  const pointer = (await readJson(join(artifacts, 'verify/current.json'))) as { id: string };
  attempt = join(artifacts, 'verify/attempts', pointer.id);
  const proposal = {
    version: 1,
    base_sha: current.base_sha,
    head_sha: current.head_sha,
    changed_paths: current.changed_paths,
    affected_behaviors: [{ id: 'install.health', confidence: 'high', rationale: 'Unit fixture' }],
    coverage_gaps: [],
  };
  const catalog = await loadCatalog();
  const selection = normalizeProposal(catalog, proposal, current);
  await writeJson(join(attempt, 'selection.json'), selection);
  await writeJson(join(attempt, 'normalization.json'), {
    ok: true,
    selection_sha256: digest(selection),
  });
  const evidence = join(attempt, 'evidence/fixture');
  await mkdir(evidence, { recursive: true });
  proofPath = join(evidence, 'result.json');
  await writeJson(proofPath, {
    version: 1,
    ok: true,
    verdict: 'PASS',
    mode: 'selection',
    repo,
    product: current,
    catalog_sha256: catalog.sha256,
    selection_sha256: digest(selection),
    tooling_sha256: await toolingDigest(),
    behavior_ids: selection.behavior_ids,
    scenario_ids: selection.scenario_ids,
    scenarios: [{ id: 'install.health', status: 'passed', errors: [] }],
    errors: [],
  });
  await writeJson(join(attempt, 'execution.json'), { completed: true, result_path: proofPath });
});

afterEach(async (): Promise<void> => {
  await rm(dir, { recursive: true, force: true });
});

test('valid exact-head complete proof permits PR authorization', async (): Promise<void> => {
  expect((await assertPass(repo, artifacts, attemptId)).ok).toBe(true);
});

test('functional PASS with a visual failure cannot authorize the workflow', async (): Promise<void> => {
  // The gate checks the pinned design inputs before it can inspect a UI result.
  await writeFile(
    join(repo, '.git/info/exclude'),
    visualConfig.sources.map(source => `/${source.path}`).join('\n') + '\n'
  );
  for (const source of visualConfig.sources) {
    await mkdir(dirname(join(repo, source.path)), { recursive: true });
    await copyFile(join(TOOLING_REPO, source.path), join(repo, source.path));
  }
  const current = await snapshot(repo, baseSha);
  const selected = normalizeProposal(
    await loadCatalog(),
    {
      version: 1,
      base_sha: current.base_sha,
      head_sha: current.head_sha,
      changed_paths: current.changed_paths,
      affected_behaviors: [
        { id: 'install.health', confidence: 'high', rationale: 'CLI fixture change' },
        { id: 'ui.tools', confidence: 'high', rationale: 'Required tool-row visual proof' },
      ],
      coverage_gaps: [],
    },
    current
  );
  await writeJson(join(attempt, 'selection.json'), selected);
  await writeJson(join(attempt, 'normalization.json'), {
    ok: true,
    selection_sha256: digest(selected),
  });
  const result = (await readJson(proofPath)) as Record<string, unknown>;
  await writeJson(proofPath, {
    ...result,
    selection_sha256: digest(selected),
    behavior_ids: selected.behavior_ids,
    scenario_ids: selected.scenario_ids,
    scenarios: selected.scenario_ids.map(id => ({
      id,
      status: id === 'ui.visual' ? 'failed' : 'passed',
      errors: id === 'ui.visual' ? ['Required visual criterion failed'] : [],
    })),
  });
  const gate = await recordAttempt(repo, artifacts, attemptId);
  expect(gate.ok).toBe(false);
  expect(gate.errors.join(' ')).toContain('ui.visual');
});

test('proposal path ordering does not invalidate otherwise identical proof', async (): Promise<void> => {
  await mkdir(join(repo, 'packages/cli/src/commands'), { recursive: true });
  await writeFile(join(repo, 'packages/cli/src/commands/doctor.ts'), 'export {};');
  await writeFile(join(repo, 'packages/cli/src/commands/doctor.test.ts'), 'export {};');
  await git(repo, [
    'add',
    'packages/cli/src/commands/doctor.ts',
    'packages/cli/src/commands/doctor.test.ts',
  ]);
  await git(repo, [
    '-c',
    'user.name=Gate Test',
    '-c',
    'user.email=gate@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'fixture change',
  ]);
  const current = await snapshot(repo, baseSha);
  const selection = normalizeProposal(
    await loadCatalog(),
    {
      version: 1,
      base_sha: baseSha,
      head_sha: current.head_sha,
      changed_paths: [...current.changed_paths].reverse(),
      affected_behaviors: [{ id: 'install.health', confidence: 'high', rationale: 'Unit fixture' }],
      coverage_gaps: [],
    },
    current
  );
  await writeJson(join(attempt, 'selection.json'), selection);
  await writeJson(join(attempt, 'normalization.json'), {
    ok: true,
    selection_sha256: digest(selection),
  });
  const result = (await readJson(proofPath)) as Record<string, unknown>;
  await writeJson(proofPath, { ...result, product: current, selection_sha256: digest(selection) });
  expect((await assertPass(repo, artifacts, attemptId)).ok).toBe(true);
});

for (const status of ['failed', 'flaky', 'skipped', 'unsupported']) {
  test(`${status} proof fails even if its top-level verdict claims PASS`, async (): Promise<void> => {
    const result = (await readJson(proofPath)) as Record<string, unknown>;
    await writeJson(proofPath, {
      ...result,
      scenarios: [{ id: 'install.health', status, errors: ['required proof not established'] }],
    });
    expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(false);
    await expect(assertPass(repo, artifacts, attemptId)).rejects.toThrow('PR blocked');
  });
}

test('missing scenario, missing result, and malformed result cannot reuse gate PASS', async (): Promise<void> => {
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(true);
  const result = (await readJson(proofPath)) as Record<string, unknown>;
  await writeJson(proofPath, { ...result, scenarios: [] });
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(false);
  await rm(proofPath);
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(false);
  await writeFile(proofPath, 'PASS');
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(false);
});

test('a new attempt invalidates old PASS before selection or preparation', async (): Promise<void> => {
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(true);
  await beginAttempt(repo, artifacts);
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(false);
  await expect(assertPass(repo, artifacts, attemptId)).rejects.toThrow('PR blocked');
});

test('dirty checkout and changed HEAD both block an older passing proof', async (): Promise<void> => {
  await writeFile(join(repo, 'change.txt'), 'changed');
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(false);
  await git(repo, ['add', 'change.txt']);
  await git(repo, [
    '-c',
    'user.name=Gate Test',
    '-c',
    'user.email=gate@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'fix',
  ]);
  await expect(assertPass(repo, artifacts, attemptId)).rejects.toThrow('PR blocked');
});

test('missing or wrong begin receipt rejects an old PASS even when its pointer survives', async (): Promise<void> => {
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(true);
  expect((await recordAttempt(repo, artifacts, '')).ok).toBe(false);
  await expect(assertPass(repo, artifacts, 'not-a-successful-begin')).rejects.toThrow(
    'begin receipt'
  );
  const oldPointer = await readJson(join(artifacts, 'verify/current.json'));
  await rm(join(artifacts, 'verify/attempts'), { recursive: true });
  await writeFile(join(artifacts, 'verify/attempts'), 'prevent initialization');
  await expect(beginAttempt(repo, artifacts)).rejects.toThrow();
  expect(await readJson(join(artifacts, 'verify/current.json'))).toEqual(oldPointer);
  expect((await recordAttempt(repo, artifacts, '')).errors.join(' ')).toContain('begin receipt');
});

test('changed tooling and a foreign attempt result both block PASS', async (): Promise<void> => {
  const result = (await readJson(proofPath)) as Record<string, unknown>;
  await writeJson(proofPath, { ...result, tooling_sha256: '0'.repeat(64) });
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(false);
  await writeJson(join(attempt, 'execution.json'), {
    completed: true,
    result_path: join(dir, 'old/result.json'),
  });
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(false);
});

test('normalization rejects a substituted base and preserves its error for the report', async (): Promise<void> => {
  const current = await snapshot(repo, baseSha);
  const proposal = {
    version: 1,
    base_sha: '0'.repeat(40),
    head_sha: current.head_sha,
    changed_paths: current.changed_paths,
    affected_behaviors: [{ id: 'install.health', confidence: 'high', rationale: 'Wrong base' }],
    coverage_gaps: [],
  };
  await expect(normalizeAttempt(repo, artifacts, proposal)).rejects.toThrow('workflow base');
  const gate = await recordAttempt(repo, artifacts, attemptId);
  expect(gate.ok).toBe(false);
  expect(gate.errors.join(' ')).toContain('workflow base');
});

test('normalization uses the real helper and reports coverage gaps, never a fallback', async (): Promise<void> => {
  const current = await snapshot(repo, baseSha);
  const proposal = {
    version: 1,
    base_sha: current.base_sha,
    head_sha: current.head_sha,
    changed_paths: current.changed_paths,
    affected_behaviors: [{ id: 'install.health', confidence: 'high', rationale: 'Adapter check' }],
    coverage_gaps: [],
  };
  expect((await normalizeAttempt(repo, artifacts, proposal)).scenario_ids).toEqual([
    'install.health',
  ]);
  await expect(
    normalizeAttempt(repo, artifacts, { ...proposal, coverage_gaps: ['workflow.other-semantics'] })
  ).rejects.toThrow('Coverage gap');
  expect((await recordAttempt(repo, artifacts, attemptId)).errors.join(' ')).toContain(
    'workflow.other-semantics'
  );
});
