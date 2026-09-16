import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliRuntimeEnv } from './runner';
import {
  digestToolingEntries,
  git,
  loadCatalog,
  repoRoot,
  runCommand,
  skillRoot,
  snapshot,
  writeJson,
} from './io';
import { normalizeProposal } from './contract';
import { isolatedEnv } from '../../../../e2e/lib/playwright/archon-runtime';

const temporary: string[] = [];
afterEach(async (): Promise<void> => {
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

test('proof overrides cannot reuse an operator endpoint or home', (): void => {
  const env = cliRuntimeEnv('/product', '/proof');
  expect(env.ARCHON_VERIFY_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(env.ARCHON_VERIFY_HOME).toBe('/proof/runtime/home');
});

test('manual normalization binds an independent base and invalidates stale output', async (): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'archon-proof-selection-'));
  temporary.push(dir);
  const repo = join(dir, 'product');
  const output = join(dir, 'selection.json');
  const proposalPath = join(dir, 'proposal.json');
  await mkdir(join(repo, 'packages/cli/src/commands'), { recursive: true });
  await git(repo, ['init', '-q']);
  await writeFile(join(repo, 'packages/cli/src/commands/doctor.ts'), 'export const state = 1;\n');
  await git(repo, ['add', '.']);
  await git(repo, [
    '-c',
    'user.name=Selection Test',
    '-c',
    'user.email=selection@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'base',
  ]);
  const base = (await snapshot(repo)).head_sha;
  await writeFile(join(repo, 'packages/cli/src/commands/doctor.ts'), 'export const state = 2;\n');
  await git(repo, ['add', '.']);
  await git(repo, [
    '-c',
    'user.name=Selection Test',
    '-c',
    'user.email=selection@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'head',
  ]);
  const current = await snapshot(repo);
  await writeJson(proposalPath, {
    version: 1,
    base_sha: current.head_sha,
    head_sha: current.head_sha,
    changed_paths: [],
    affected_behaviors: [
      { id: 'install.health', confidence: 'high', rationale: 'Attempt to omit the real diff' },
    ],
    coverage_gaps: [],
  });
  await writeFile(output, '{"old":"selection"}\n');
  const result = await runCommand(
    [
      join(skillRoot, 'bin/verify-archon'),
      'normalize-selection',
      proposalPath,
      '--repo',
      repo,
      '--base',
      base,
      '--out',
      output,
    ],
    dir,
    dir,
    'normalize-malicious'
  );
  expect(result.exit_code).not.toBe(0);
  await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(result.stdout, 'utf8')).toContain('Selection SHA is stale');
});

test('historical empty-diff selection requires explicit mode for normalization and validation', async (): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'archon-proof-historical-'));
  temporary.push(dir);
  const repo = join(dir, 'product');
  const proposalPath = join(dir, 'proposal.json');
  const selectionPath = join(dir, 'selection.json');
  await mkdir(repo);
  await git(repo, ['init', '-q']);
  await git(repo, [
    '-c',
    'user.name=Historical Test',
    '-c',
    'user.email=historical@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-qm',
    'historical target',
  ]);
  const current = await snapshot(repo);
  await writeJson(proposalPath, {
    version: 1,
    base_sha: current.head_sha,
    head_sha: current.head_sha,
    changed_paths: [],
    affected_behaviors: [
      { id: 'install.health', confidence: 'high', rationale: 'Named historical behavior' },
    ],
    coverage_gaps: [],
  });
  const normalized = await runCommand(
    [
      join(skillRoot, 'bin/verify-archon'),
      'normalize-selection',
      proposalPath,
      '--repo',
      repo,
      '--base',
      'HEAD',
      '--historical',
      '--out',
      selectionPath,
    ],
    dir,
    dir,
    'normalize-historical'
  );
  expect(normalized.exit_code).toBe(0);
  const rejected = await runCommand(
    [
      join(skillRoot, 'bin/verify-archon'),
      'validate-selection',
      selectionPath,
      '--repo',
      repo,
      '--base',
      'HEAD',
    ],
    dir,
    dir,
    'validate-without-historical'
  );
  expect(rejected.exit_code).not.toBe(0);
  expect(await readFile(rejected.stdout, 'utf8')).toContain('historical');
  const accepted = await runCommand(
    [
      join(skillRoot, 'bin/verify-archon'),
      'validate-selection',
      selectionPath,
      '--repo',
      repo,
      '--base',
      'HEAD',
      '--historical',
    ],
    dir,
    dir,
    'validate-historical'
  );
  expect(accepted.exit_code).toBe(0);
});

test('browser runtime pins loopback and disables live integrations with empty values', (): void => {
  const env = isolatedEnv('/proof/home', 13900);
  expect(env.HOST).toBe('127.0.0.1');
  expect(env.DATABASE_URL).toBe('');
  expect(env.DEFAULT_AI_ASSISTANT).toBe('e2e-fake');
  for (const key of [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'TELEGRAM_BOT_TOKEN',
    'DISCORD_BOT_TOKEN',
    'BETTER_AUTH_SECRET',
  ]) {
    expect(env[key]).toBe('');
  }
});

test('tooling digest changes when an executable dependency changes', async (): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'archon-proof-digest-'));
  temporary.push(dir);
  const dependency = join(dir, 'dependency.ts');
  const lockfile = join(dir, 'bun.lock');
  await writeFile(dependency, 'export const version = 1;\n');
  await writeFile(lockfile, 'lock-version-1\n');
  const entries = [
    { path: dependency, label: 'dependency.ts' },
    { path: lockfile, label: 'bun.lock' },
  ];
  const before = await digestToolingEntries(entries);
  await writeFile(dependency, 'export const version = 2;\n');
  expect(await digestToolingEntries(entries)).not.toBe(before);
});

test('catalog impact paths match at least one checkout file', async (): Promise<void> => {
  const catalog = await loadCatalog();
  const dead: string[] = [];
  for (const feature of catalog.features) {
    const patterns = [
      ...feature.impact_paths,
      ...feature.behaviors.flatMap(behavior => behavior.impact_paths ?? []),
    ];
    for (const pattern of patterns) {
      let matched = false;
      for await (const _path of new Bun.Glob(pattern).scan({
        cwd: repoRoot,
        onlyFiles: true,
        dot: true,
      })) {
        matched = true;
        break;
      }
      if (!matched) dead.push(`${feature.id}: ${pattern}`);
    }
  }
  expect(dead).toEqual([]);
});

test('known room ownership consumers require Ask lifecycle proof even with high-confidence history impact', async (): Promise<void> => {
  const catalog = await loadCatalog();
  for (const path of [
    'packages/web/src/components/workflows/NodeTranscriptPane.tsx',
    'packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx',
    'packages/web/src/experiments/console/routes/RunDetailPage.tsx',
  ]) {
    const snapshot = {
      base_sha: 'a'.repeat(40),
      head_sha: 'b'.repeat(40),
      changed_paths: [path],
      dirty: false,
    };
    const result = normalizeProposal(
      catalog,
      {
        version: 1,
        base_sha: snapshot.base_sha,
        head_sha: snapshot.head_sha,
        changed_paths: [path],
        affected_behaviors: [
          {
            id: 'hitl.history',
            confidence: 'high',
            rationale: 'Only history is believed affected',
          },
        ],
        coverage_gaps: [],
      },
      snapshot
    );
    expect(result.scenario_ids).toContain('hitl.console-unowned-ask');
    expect(result.scenario_ids).toContain('hitl.legacy-unowned-ask');
  }
});

test('verification tooling changes select the executable contract scenario', async (): Promise<void> => {
  const catalog = await loadCatalog();
  const changed = {
    base_sha: 'a'.repeat(40),
    head_sha: 'b'.repeat(40),
    changed_paths: ['.archon/scripts/verify-feature-gate.ts'],
    dirty: false,
  };
  const selection = normalizeProposal(
    catalog,
    {
      version: 1,
      base_sha: changed.base_sha,
      head_sha: changed.head_sha,
      changed_paths: changed.changed_paths,
      affected_behaviors: [
        {
          id: 'verification.contract',
          confidence: 'high',
          rationale: 'The deterministic proof gate changed.',
        },
      ],
      coverage_gaps: [],
    },
    changed
  );
  expect(selection.scenario_ids).toEqual(['verification.contract']);
  const dir = await mkdtemp(join(tmpdir(), 'archon-proof-contract-recipe-'));
  temporary.push(dir);
  const supported = await runCommand(
    ['bash', join(skillRoot, 'bin/runtime'), 'supports', 'verification-contract'],
    dir,
    dir,
    'supports-verification-contract'
  );
  expect(supported.exit_code).toBe(0);
});

test('a crashing product doctor is a failed prerequisite, not an offline pass', async (): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'archon-proof-doctor-'));
  temporary.push(dir);
  const repo = join(dir, 'product');
  const home = join(dir, 'home');
  const stateDir = join(dir, 'runtime');
  await mkdir(join(repo, 'node_modules'), { recursive: true });
  await mkdir(join(repo, 'packages/cli/src'), { recursive: true });
  await mkdir(home);
  await mkdir(stateDir);
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'archon', scripts: { cli: 'bun packages/cli/src/cli.ts' } }, null, 2)
  );
  await writeFile(join(repo, 'packages/cli/src/cli.ts'), 'process.exit(42);\n');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (): Response => Response.json({ status: 'ok' }),
  });
  try {
    await writeFile(
      join(stateDir, 'state.json'),
      JSON.stringify({
        runId: 'doctor-fixture',
        archonHome: home,
        port: server.port,
        baseUrl: `http://127.0.0.1:${server.port}`,
        spawnPid: process.pid,
        listenPid: process.pid,
      })
    );
    const result = await runCommand(
      ['bash', join(skillRoot, 'bin/runtime'), 'doctor', '--json'],
      dir,
      dir,
      'doctor',
      {
        ARCHON_VERIFY_REPO_ROOT: repo,
        ARCHON_VERIFY_STATE_DIR: stateDir,
        ARCHON_VERIFY_EVIDENCE: join(dir, 'evidence'),
        ARCHON_VERIFY_BASE_URL: `http://127.0.0.1:${server.port}`,
        ARCHON_VERIFY_TARGET: 'local',
      }
    );
    expect(result.exit_code).not.toBe(0);
    const body = JSON.parse(await readFile(result.stdout, 'utf8')) as {
      ok: boolean;
      checks: { name: string; status: string }[];
    };
    expect(body.ok).toBe(false);
    expect(body.checks.find(check => check.name === 'productDoctor')?.status).toBe('fail');
  } finally {
    await server.stop(true);
  }
});

test('a timeout cannot become success when SIGTERM exits zero', async (): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'archon-proof-timeout-'));
  temporary.push(dir);
  const result = await runCommand(
    ['bun', '-e', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"],
    dir,
    dir,
    'timeout',
    {},
    500
  );
  expect(result.timed_out).toBe(true);
  expect(result.exit_code).not.toBe(0);
}, 10_000);

test('timeout also stops a CLI descendant that ignores SIGTERM', async (): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'archon-proof-descendant-'));
  temporary.push(dir);
  const childFile = join(dir, 'child.ts');
  const pidFile = join(dir, 'child.pid');
  await writeFile(
    childFile,
    `process.on('SIGTERM', () => {}); await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`
  );
  let pid: number | undefined;
  try {
    const result = await runCommand(
      ['bash', '-c', 'bun "$1" & wait', 'proof-wrapper', childFile],
      dir,
      dir,
      'timeout-child',
      {},
      500
    );
    pid = Number(await readFile(pidFile, 'utf8'));
    expect(result.timed_out).toBe(true);
    // SIGKILL delivery and the OS reaping the orphan are asynchronous.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(() => process.kill(pid as number, 0)).toThrow();
  } finally {
    if (pid !== undefined) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  }
}, 10_000);

test('failed server startup records ownership so cleanup can remove its home', async (): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'archon-proof-startup-'));
  temporary.push(dir);
  const repo = join(dir, 'product');
  const runtime = join(dir, 'runtime');
  await mkdir(join(repo, 'node_modules'), { recursive: true });
  await mkdir(join(repo, 'packages/server/src'), { recursive: true });
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify(
      { name: 'archon', scripts: { 'dev:server': 'bun packages/server/src/index.ts' } },
      null,
      2
    )
  );
  await writeFile(join(repo, 'packages/server/src/index.ts'), 'process.exit(0);\n');
  const env = {
    ARCHON_VERIFY_REPO_ROOT: repo,
    ARCHON_VERIFY_STATE_DIR: runtime,
    ARCHON_VERIFY_EVIDENCE: join(dir, 'evidence'),
    ARCHON_VERIFY_HOME: join(runtime, 'home'),
    ARCHON_VERIFY_TARGET: 'local',
    ARCHON_VERIFY_PORT: '13990',
  };
  const launch = await runCommand(
    ['bash', join(skillRoot, 'bin/runtime'), 'launch', '--json'],
    dir,
    dir,
    'launch',
    env
  );
  expect(launch.exit_code).not.toBe(0);
  const state = JSON.parse(await readFile(join(runtime, 'state.json'), 'utf8')) as {
    spawnPid: number;
    archonHome: string;
  };
  expect(state.spawnPid).toBeGreaterThan(0);
  expect(state.archonHome).toBe(join(runtime, 'home'));
  const cleanup = await runCommand(
    ['bash', join(skillRoot, 'bin/runtime'), 'cleanup', '--json'],
    dir,
    dir,
    'cleanup',
    env
  );
  expect(cleanup.exit_code).toBe(0);
  await expect(stat(join(runtime, 'home'))).rejects.toMatchObject({ code: 'ENOENT' });
}, 10_000);
