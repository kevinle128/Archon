import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  toolingDigest,
  writeJson,
} from '../.agents/skills/verify-archon/lib/io';

let dir: string;
let repo: string;
let artifacts: string;
let attempt: string;
let attemptId: string;
let proofPath: string;

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
  attemptId = await beginAttempt(repo, artifacts);
  await prepareAttempt(repo, artifacts);
  const pointer = (await readJson(join(artifacts, 'verify/current.json'))) as { id: string };
  attempt = join(artifacts, 'verify/attempts', pointer.id);
  const proposal = {
    version: 1,
    affected_behaviors: [{ id: 'install.health', confidence: 'high', rationale: 'Unit fixture' }],
    coverage_gaps: [],
  };
  const catalog = await loadCatalog();
  const selection = normalizeProposal(catalog, proposal);
  await writeJson(join(attempt, 'selection.json'), selection);
  await writeJson(join(attempt, 'normalization.json'), {
    ok: true,
    selection_sha256: digest(selection),
  });
  const evidence = join(attempt, 'evidence/fixture');
  await mkdir(evidence, { recursive: true });
  proofPath = join(evidence, 'result.json');
  await writeFile(join(evidence, 'transcript.txt'), 'Observed CLI result');
  await writeJson(proofPath, {
    version: 1,
    run_id: 'test-run',
    evidence_dir: evidence,
    ok: true,
    verdict: 'PASS',
    mode: 'selection',
    repo,
    product: null,
    catalog_sha256: catalog.sha256,
    selection_sha256: digest(selection),
    tooling_sha256: await toolingDigest(),
    behavior_ids: selection.behavior_ids,
    scenario_ids: selection.scenario_ids,
    scenarios: [
      {
        id: 'install.health',
        status: 'passed',
        errors: [],
        attachments: [{ name: 'cli', path: 'transcript.txt' }],
      },
    ],
    errors: [],
  });
  await writeJson(join(attempt, 'execution.json'), { completed: true, result_path: proofPath });
});

afterEach(async (): Promise<void> => {
  await rm(dir, { recursive: true, force: true });
});

test('complete proof permits PR authorization', async (): Promise<void> => {
  expect((await assertPass(repo, artifacts, attemptId)).ok).toBe(true);
});

test('functional PASS with a visual failure cannot authorize the workflow', async (): Promise<void> => {
  const selected = normalizeProposal(await loadCatalog(), {
    version: 1,
    affected_behaviors: [
      { id: 'install.health', confidence: 'high', rationale: 'CLI fixture change' },
      { id: 'ui.tools', confidence: 'high', rationale: 'Required tool-row visual proof' },
    ],
    coverage_gaps: [],
  });
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
      attachments: [{ name: id, path: 'transcript.txt' }],
    })),
  });
  const gate = await recordAttempt(repo, artifacts, attemptId);
  expect(gate.ok).toBe(false);
  expect(gate.errors.join(' ')).toContain('ui.visual');
});

for (const status of ['failed', 'flaky', 'skipped', 'unsupported']) {
  test(`${status} proof fails even if its top-level verdict claims PASS`, async (): Promise<void> => {
    const result = (await readJson(proofPath)) as Record<string, unknown>;
    await writeJson(proofPath, {
      ...result,
      scenarios: [
        {
          id: 'install.health',
          status,
          errors: ['required proof not established'],
          attachments: [{ name: 'cli', path: 'transcript.txt' }],
        },
      ],
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

test('missing retained evidence cannot authorize a passing result', async (): Promise<void> => {
  await rm(join(dirname(proofPath), 'transcript.txt'));
  const gate = await recordAttempt(repo, artifacts, attemptId);
  expect(gate.ok).toBe(false);
  expect(gate.errors.join(' ')).toContain('Missing attachment');
});

test('target report checkpoint and local notes do not block completed proof', async (): Promise<void> => {
  await writeFile(join(repo, 'verification-notes.md'), 'changed');
  expect((await recordAttempt(repo, artifacts, attemptId)).ok).toBe(true);
  await git(repo, ['add', 'verification-notes.md']);
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
  expect((await assertPass(repo, artifacts, attemptId)).ok).toBe(true);
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

test('normalization rejects unknown behaviors and preserves its error for the report', async (): Promise<void> => {
  const proposal = {
    version: 1,
    affected_behaviors: [
      { id: 'missing.behavior', confidence: 'high', rationale: 'Unknown user path' },
    ],
    coverage_gaps: [],
  };
  await expect(normalizeAttempt(repo, artifacts, proposal)).rejects.toThrow('Unknown behavior');
  const gate = await recordAttempt(repo, artifacts, attemptId);
  expect(gate.ok).toBe(false);
  expect(gate.errors.join(' ')).toContain('Unknown behavior');
});

test('normalization uses the real helper and reports coverage gaps, never a fallback', async (): Promise<void> => {
  const proposal = {
    version: 1,
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
