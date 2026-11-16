/**
 * Tests for the bundled `omb-fork-upstream-resolve` workflow.
 *
 * The bash bodies are executed for real: each test renders a node through the same
 * substitution functions the executor uses and runs it with fake `gh`, `sleep`, `node`
 * and `pnpm`. No test reaches the network, and the fake `pnpm` stands in for vitest, so
 * the sorting of failed test files is tested without running a real suite.
 */
import { describe, it, expect, afterEach, setDefaultTimeout } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkflow } from '../loader';
import { substituteNodeOutputRefs } from '../dag-executor';
import { substituteWorkflowVariables } from '../executor-shared';
import type { DagNode, WorkflowDefinition } from '../schemas';
import { BUNDLED_WORKFLOWS } from './bundled-defaults';

const NAME = 'omb-fork-upstream-resolve';
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const YAML_PATH = join(REPO_ROOT, '.archon/workflows/defaults', `${NAME}.yaml`);
const YAML_TEXT = readFileSync(YAML_PATH, 'utf-8');
const RUN_ID = 'abcdef0123456789abcdef0123456789';
const FORK_REPO = 'kevinle128/OpenMausBot';
const ISSUE = 42;
const REAL_GIT = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

function loadWorkflow(): WorkflowDefinition {
  const result = parseWorkflow(YAML_TEXT, `${NAME}.yaml`);
  if (result.workflow === null) throw new Error(result.error.error);
  return result.workflow;
}

const WORKFLOW = loadWorkflow();

function nodeById(id: string): DagNode {
  const node = WORKFLOW.nodes.find(n => n.id === id);
  if (!node) throw new Error(`node ${id} missing`);
  return node;
}

function bashOf(id: string): string {
  const node = nodeById(id) as { bash?: string };
  if (typeof node.bash !== 'string') throw new Error(`node ${id} has no bash`);
  return node.bash;
}

/** The body of a quoted heredoc `<<'TAG'` ... `TAG` inside a node's bash. */
function heredoc(text: string, tag: string): string {
  const open = `<<'${tag}'\n`;
  const start = text.indexOf(open);
  const end = text.indexOf(`\n${tag}\n`, start);
  if (start < 0 || end < 0) throw new Error(`heredoc ${tag} missing`);
  return text.slice(start + open.length, end + 1);
}

/** Render a shell body the way the executor does for bash nodes. */
function render(body: string, artifactsDir: string): string {
  const { prompt } = substituteWorkflowVariables(
    body,
    RUN_ID,
    `resolve issue #${ISSUE}`,
    artifactsDir,
    'main',
    'docs/',
    undefined,
    undefined,
    undefined,
    undefined,
    { shellSafe: true, stateDir: join(artifactsDir, 'state') }
  );
  return substituteNodeOutputRefs(prompt, new Map(), true);
}

// ---------------------------------------------------------------------------
// Sandbox: temp dirs, fake tools, isolated git config
// ---------------------------------------------------------------------------

interface Sandbox {
  root: string;
  bin: string;
  artifacts: string;
  sync: string;
  log: string;
  scenario: string;
  env: NodeJS.ProcessEnv;
}

const sandboxes: string[] = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

// `gh issue list` answers from a file, or fails with FAKE_ISSUE_LIST_CODE; every other
// call the lookup tests make is either answered or fails loudly.
const FAKE_GH = `#!/bin/bash
printf '%s\\n' "gh $*" >> "$FAKE_LOG"
case "$1 $2" in
  "repo view") printf '%s\\n' "$FAKE_REPO" ;;
  "issue list")
    if [ "\${FAKE_ISSUE_LIST_CODE:-0}" != 0 ]; then
      echo "gh: HTTP 502 from the issue list" >&2
      exit "$FAKE_ISSUE_LIST_CODE"
    fi
    cat "$FAKE_ISSUE_LIST_JSON" ;;
  "issue view") cat "$FAKE_ISSUE_JSON" ;;
  "pr list") echo '[]' ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 99 ;;
esac
`;

const FAKE_SLEEP = `#!/bin/bash
printf '%s\\n' "sleep $*" >> "$FAKE_LOG"
`;

// node answers the version probe with 24 and accepts every other call.
const FAKE_NODE = `#!/bin/bash
if [ "$1" = -p ]; then echo 24; fi
exit 0
`;

// pnpm stands in for vitest. A full run (`pnpm exec vitest run`, no file) prints
// $FAKE_SCENARIO/full.out and exits with full.code. A run of one file (with the JSON
// reporter) uses the next line of $FAKE_SCENARIO/<where>/<path with / as _>, where
// <where> is "branch" or "base" (the base worktree); the last line repeats and a
// missing file means a pass. A line is an exit code, then optionally the failed test
// names separated by ";" (SUITE for a suite error, OTHER for an exit code caused by another file that the filter matched, UNHANDLED for an unhandled error with a clean report). A file "<key>.other" makes the
// report name another file, the way vitest's substring filter can.
const FAKE_PNPM = `#!/bin/bash
printf '%s\\n' "pnpm $* (in $PWD)" >> "$FAKE_LOG"
if [ "$1 $2 $3" = "exec vitest run" ]; then
  if [ "$#" -eq 3 ]; then
    cat "$FAKE_SCENARIO/full.out"
    exit "$(cat "$FAKE_SCENARIO/full.code")"
  fi
  if [ "$#" -eq 7 ]; then
    where=branch
    case "$PWD" in *base-worktree*) where=base ;; esac
    key="$FAKE_SCENARIO/$where/$(printf '%s' "$4" | tr / _)"
    n=$(( $(cat "$key.count" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$key.count"
    line="0"
    if [ -f "$key" ]; then
      line=$(sed -n "\${n}p" "$key")
      [ -n "$line" ] || line=$(tail -n 1 "$key")
    fi
    code=\${line%% *}
    names=case
    case "$line" in *" "*) names=\${line#* } ;; esac
    report="\${7#--outputFile.json=}"
    name="$PWD/$4"
    [ -f "$key.other" ] && name="$PWD/$4x"
    [ "$names" = UNHANDLED ] && printf ' Test Files  1 passed (1)\\n      Errors  1 error\\n'
    jq -n --arg n "$name" --arg code "$code" --arg names "$names" '
      ($code == "0" or $names == "OTHER" or $names == "UNHANDLED") as $ok
      | {testResults: ([{name: $n,
        status: (if $ok then "passed" else "failed" end),
        assertionResults:
          (if $ok then [{status: "passed", fullName: "ok"}]
           elif $names == "SUITE" then []
           else [($names | split(";"))[] | {status: "failed", fullName: .}] end)}]
        + (if $names == "OTHER" then [{name: ($n + "x"), status: "failed",
            assertionResults: [{status: "failed", fullName: "other"}]}] else [] end))}' > "$report"
    exit "$code"
  fi
fi
exit 0
`;

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'omb-fork-resolve-'));
  sandboxes.push(root);
  const bin = join(root, 'bin');
  const artifacts = join(root, 'artifacts');
  const sync = join(artifacts, 'sync');
  const scenario = join(root, 'scenario');
  mkdirSync(bin, { recursive: true });
  mkdirSync(sync, { recursive: true });
  mkdirSync(join(scenario, 'branch'), { recursive: true });
  mkdirSync(join(scenario, 'base'), { recursive: true });
  writeExecutable(join(bin, 'gh'), FAKE_GH);
  writeExecutable(join(bin, 'sleep'), FAKE_SLEEP);
  writeExecutable(join(bin, 'node'), FAKE_NODE);
  writeExecutable(join(bin, 'pnpm'), FAKE_PNPM);
  const realJq = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
  if (realJq) writeExecutable(join(bin, 'jq'), `#!/bin/bash\nexec "${realJq}" "$@"\n`);
  const gitConfig = join(root, 'gitconfig');
  writeFileSync(gitConfig, '[init]\n\tdefaultBranch = main\n');
  const log = join(root, 'calls.log');
  writeFileSync(log, '');
  writeFileSync(join(root, 'issue-list.json'), '[]');
  return {
    root,
    bin,
    artifacts,
    sync,
    log,
    scenario,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: root,
      ARTIFACTS_DIR: artifacts,
      WORKFLOW_ID: RUN_ID,
      CLEANUP_WATCH_POLLS: '0',
      FORK_SYNC_NODE_BIN: join(root, 'no-such-node-dir'),
      FORK_SYNC_BUILD_LOCK: join(root, 'build.lock'),
      FAKE_LOG: log,
      FAKE_REPO: FORK_REPO,
      FAKE_ISSUE_JSON: join(root, 'issue.json'),
      FAKE_ISSUE_LIST_JSON: join(root, 'issue-list.json'),
      FAKE_SCENARIO: scenario,
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.test',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.test',
    },
  };
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(
  sb: Sandbox,
  script: string,
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
  args: string[] = []
): RunResult {
  const result = spawnSync('bash', ['-c', script, 'node', ...args], {
    cwd,
    env: { ...sb.env, ...extraEnv },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(sb: Sandbox, cwd: string, ...args: string[]): string {
  const result = spawnSync(REAL_GIT, args, { cwd, env: sb.env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function calls(sb: Sandbox): string[] {
  return readFileSync(sb.log, 'utf-8').split('\n').filter(Boolean);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('omb-fork-upstream-resolve structure', () => {
  it('loads with the real loader without warnings', () => {
    const result = parseWorkflow(YAML_TEXT, `${NAME}.yaml`);
    expect(result.error).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('has the expected nodes and returns the finalize node', () => {
    expect(WORKFLOW.nodes.map(n => n.id)).toEqual([
      'prepare',
      'resolve',
      'check',
      'fix-checks',
      'publish',
      'create-pr',
      'create-test-pr',
      'verify-pr',
      'wait-ci',
      'rerun-ci',
      'fix-ci',
      'merge-pr',
      'finalize',
    ]);
    expect(WORKFLOW.returns).toBe('finalize');
    expect(nodeById('fix-checks').when).toBe("$check.output.passed == 'false'");
  });

  it('is bundled with the same text as the YAML file', () => {
    expect(BUNDLED_WORKFLOWS[NAME]).toBe(YAML_TEXT.replace(/\r\n/g, '\n'));
  });

  it('tells the fix pass to leave flaky and pre-existing test files alone', () => {
    const group = nodeById('fix-checks') as unknown as {
      loop_group: { nodes: { id: string; prompt_suffix?: string }[] };
    };
    const attempt = group.loop_group.nodes.find(n => n.id === 'fix-checks-attempt');
    expect(attempt?.prompt_suffix).toContain('only the test files that');
    expect(attempt?.prompt_suffix).toContain('flaky under load or pre-existing are warnings');
  });
});

// ---------------------------------------------------------------------------
// Issue lookup in prepare
// ---------------------------------------------------------------------------

describe('prepare node issue lookup (executable)', () => {
  function runPrepare(sb: Sandbox, extraEnv: NodeJS.ProcessEnv): RunResult {
    const work = join(sb.root, 'work');
    mkdirSync(work, { recursive: true });
    git(sb, work, 'init', '-q', '-b', 'main');
    git(sb, work, 'remote', 'add', 'origin', `https://github.com/${FORK_REPO}.git`);
    return run(sb, render(bashOf('prepare'), sb.artifacts), work, extraEnv);
  }
  const sleepsOf = (sb: Sandbox): number[] =>
    calls(sb)
      .filter(c => c.startsWith('sleep '))
      .map(c => Number(c.slice('sleep '.length)));
  const listCalls = (sb: Sandbox): number =>
    calls(sb).filter(c => c.startsWith('gh issue list')).length;
  const total = (sb: Sandbox): number => sleepsOf(sb).reduce((a, b) => a + b, 0);

  it('retries an empty list for a bounded time, then refuses', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, {});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No open upstream-sync-conflict issue');
    expect(r.stderr).not.toContain('The issue list lookup failed');
    expect(total(sb)).toBeGreaterThanOrEqual(60);
    expect(total(sb)).toBeLessThan(70);
  });

  it('does not retry a gh error and prints it with the zero-issue message', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, { FAKE_ISSUE_LIST_CODE: '1' });
    expect(r.status).toBe(1);
    expect(listCalls(sb)).toBe(1);
    expect(sleepsOf(sb)).toEqual([]);
    expect(r.stderr).toContain('No open upstream-sync-conflict issue');
    expect(r.stderr).toContain('The issue list lookup failed: gh: HTTP 502 from the issue list');
  });

  it('uses 60 seconds when ISSUE_LOOKUP_WAIT_SECONDS is not a whole number', () => {
    for (const value of ['abc', '-5', '1.5', '']) {
      const sb = makeSandbox();
      const r = runPrepare(sb, { ISSUE_LOOKUP_WAIT_SECONDS: value });
      expect(r.status).toBe(1);
      expect(total(sb)).toBeGreaterThanOrEqual(60);
      expect(total(sb)).toBeLessThan(70);
    }
  });

  it('honours a whole-number ISSUE_LOOKUP_WAIT_SECONDS', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, { ISSUE_LOOKUP_WAIT_SECONDS: '0' });
    expect(r.status).toBe(1);
    expect(sleepsOf(sb)).toEqual([]);
    expect(listCalls(sb)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// checks.sh: sorting of the failed vitest files
// ---------------------------------------------------------------------------

describe('checks.sh vitest sorting (executable)', () => {
  setDefaultTimeout(60_000);
  const FILES = ['server/a.test.ts', 'server/b.test.ts', 'web/c.test.tsx'];

  /** A repository with the test files committed, and sync.json naming that commit as base. */
  function checksRepo(sb: Sandbox): string {
    const work = join(sb.root, 'work');
    mkdirSync(work, { recursive: true });
    git(sb, work, 'init', '-q', '-b', 'main');
    for (const file of FILES) {
      mkdirSync(join(work, file, '..'), { recursive: true });
      writeFileSync(join(work, file), 'test\n');
    }
    git(sb, work, 'add', '.');
    git(sb, work, 'commit', '-q', '-m', 'base');
    writeFileSync(join(sb.sync, 'checks.sh'), heredoc(bashOf('prepare'), 'CHECKS_SH'));
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({ base_sha: git(sb, work, 'rev-parse', 'HEAD'), files: [] })
    );
    return work;
  }

  /** Exit codes of one file alone, per call, for the branch and the base. */
  function scenario(
    sb: Sandbox,
    options: {
      failed: string[];
      branch?: Record<string, (number | string)[]>;
      base?: Record<string, (number | string)[]>;
    }
  ): void {
    const lines = options.failed.map(f => ` FAIL  ${f} > suite > case\nAssertionError`);
    writeFileSync(
      join(sb.scenario, 'full.out'),
      `${lines.join('\n')}\n Test Files  ${options.failed.length} failed\n`
    );
    writeFileSync(join(sb.scenario, 'full.code'), options.failed.length > 0 ? '1' : '0');
    const maps = [
      ['branch', options.branch ?? {}],
      ['base', options.base ?? {}],
    ] as const;
    for (const [where, map] of maps) {
      for (const [file, codes] of Object.entries(map)) {
        writeFileSync(join(sb.scenario, where, file.replace(/\//g, '_')), `${codes.join('\n')}\n`);
      }
    }
  }

  interface ChecksJson {
    passed: boolean;
    failed: string[];
    warnings: { name: string; warning: string }[];
    ran: { name: string; status: string }[];
  }

  function vitest(
    sb: Sandbox,
    work: string,
    extraEnv: NodeJS.ProcessEnv = {}
  ): { r: RunResult; json: ChecksJson } {
    const r = run(sb, `bash "${join(sb.sync, 'checks.sh')}" "$@"`, work, extraEnv, ['test-vitest']);
    return { r, json: readJson<ChecksJson>(join(sb.sync, 'checks.json')) };
  }

  const aloneCalls = (sb: Sandbox, file: string, where: 'branch' | 'base'): number =>
    calls(sb).filter(
      c =>
        c.startsWith(`pnpm exec vitest run ${file} `) &&
        (where === 'base' ? c.includes('base-worktree') : !c.includes('base-worktree'))
    ).length;

  const realFailures = (sb: Sandbox): string =>
    readFileSync(join(sb.sync, 'vitest-real-failures.txt'), 'utf-8');

  it('passes without a rerun when the whole suite passes', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, { failed: [] });
    const { r, json } = vitest(sb, work);
    expect(r.status).toBe(0);
    expect(json.passed).toBe(true);
    expect(json.warnings).toEqual([]);
    expect(aloneCalls(sb, FILES[0], 'branch')).toBe(0);
  });

  it('passes with a warning when every failed file passes alone', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, { failed: [FILES[0], FILES[2]] });
    const { r, json } = vitest(sb, work);
    expect(r.status).toBe(0);
    expect(json.passed).toBe(true);
    expect(json.failed).toEqual([]);
    expect(json.ran).toEqual([{ name: 'test-vitest', status: 'warn' }]);
    expect(json.warnings).toEqual([
      {
        name: 'test-vitest',
        warning: `flaky under load (failed in the full run, passed alone on the branch): ${FILES[0]}, ${FILES[2]}`,
      },
    ]);
    // Nothing needed the base, so no base worktree was made.
    expect(calls(sb).some(c => c.includes('base-worktree'))).toBe(false);
    expect(existsSync(join(sb.sync, 'vitest-real-failures.txt'))).toBe(false);
  });

  it('accepts a file that passes on the second try alone', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, { failed: [FILES[0]], branch: { [FILES[0]]: [1, 0] } });
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(true);
    expect(aloneCalls(sb, FILES[0], 'branch')).toBe(2);
    expect(json.warnings[0].warning).toContain('flaky under load');
  });

  it('passes with a warning when a file that fails alone also fails on the base', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, {
      failed: [FILES[0], FILES[1]],
      branch: { [FILES[1]]: [1] },
      base: { [FILES[1]]: [1] },
    });
    const { r, json } = vitest(sb, work);
    expect(r.status).toBe(0);
    expect(json.passed).toBe(true);
    const baseSha = readJson<{ base_sha: string }>(join(sb.sync, 'sync.json')).base_sha;
    expect(json.warnings[0].warning.split('\n')).toEqual([
      `flaky under load (failed in the full run, passed alone on the branch): ${FILES[0]}`,
      `pre-existing (the same tests fail alone on the base ${baseSha.slice(0, 9)}): ${FILES[1]}`,
    ]);
    expect(aloneCalls(sb, FILES[1], 'branch')).toBe(2);
    expect(aloneCalls(sb, FILES[1], 'base')).toBe(1);
    // The base worktree is removed after the run.
    expect(existsSync(join(sb.sync, 'base-worktree'))).toBe(false);
    expect(git(sb, work, 'worktree', 'list').split('\n').length).toBe(1);
  });

  it('fails only for a file that fails alone on the branch and passes alone on the base', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, {
      failed: FILES,
      branch: { [FILES[1]]: [1], [FILES[2]]: [1] },
      base: { [FILES[1]]: [1], [FILES[2]]: [0] },
    });
    const { r, json } = vitest(sb, work);
    expect(r.status).toBe(0);
    expect(json.passed).toBe(false);
    expect(json.failed).toEqual(['test-vitest']);
    expect(realFailures(sb)).toBe(`${FILES[2]}\n`);
    expect(readFileSync(join(sb.sync, 'checks.log'), 'utf-8')).toContain('vitest: real failures');
  });

  it('counts a file that does not exist on the base as a failure', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    writeFileSync(join(work, 'server/new.test.ts'), 'test\n');
    git(sb, work, 'add', '.');
    git(sb, work, 'commit', '-q', '-m', 'new test');
    scenario(sb, { failed: ['server/new.test.ts'], branch: { 'server/new.test.ts': [1] } });
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(false);
    expect(realFailures(sb)).toBe('server/new.test.ts\n');
  });

  it('reads files from colored output with a project prefix', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, { failed: [] });
    writeFileSync(
      join(sb.scenario, 'full.out'),
      ` \u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m  |unit| ${FILES[0]} > suite > case\n Test Files  1 failed | 2 passed (3)\n`
    );
    writeFileSync(join(sb.scenario, 'full.code'), '1');
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(true);
    expect(json.warnings[0].warning).toContain(FILES[0]);
  });

  it('fails without a rerun when no failed file is named in the output', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, { failed: [] });
    writeFileSync(join(sb.scenario, 'full.out'), 'Error: out of memory\n');
    writeFileSync(join(sb.scenario, 'full.code'), '1');
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(false);
    expect(aloneCalls(sb, FILES[0], 'branch')).toBe(0);
  });

  it('fails without a rerun when more files failed than the cap allows', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, { failed: FILES });
    const { json } = vitest(sb, work, { VITEST_RERUN_MAX_FILES: '2' });
    expect(json.passed).toBe(false);
    expect(json.failed).toEqual(['test-vitest']);
    expect(calls(sb).some(c => /^pnpm exec vitest run \S+\.test\.\w+ --reporter/.test(c))).toBe(
      false
    );
    expect(realFailures(sb).trim().split('\n')).toEqual(FILES);
    expect(problemOf(sb)).toContain('more than 2 test files failed');
  });

  const problemOf = (sb: Sandbox): string =>
    readFileSync(join(sb.sync, 'vitest-suite-problem.txt'), 'utf-8');

  function fullOutput(sb: Sandbox, text: string): void {
    writeFileSync(join(sb.scenario, 'full.out'), text);
    writeFileSync(join(sb.scenario, 'full.code'), '1');
  }

  it('fails without a rerun when vitest reports an unhandled error next to a file that passes alone', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    fullOutput(
      sb,
      ` FAIL  ${FILES[0]} > suite > case\n Test Files  1 failed | 2 passed (3)\n      Errors  1 error\n`
    );
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(false);
    expect(aloneCalls(sb, FILES[0], 'branch')).toBe(0);
    expect(problemOf(sb)).toContain('unhandled errors');
    expect(realFailures(sb)).toBe(`${FILES[0]}\n`);
  });

  it('fails without a rerun on an "Unhandled Error" heading', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    fullOutput(
      sb,
      `⎯⎯⎯ Unhandled Errors ⎯⎯⎯\n FAIL  ${FILES[0]} > suite > case\n Test Files  1 failed | 2 passed (3)\n`
    );
    expect(vitest(sb, work).json.passed).toBe(false);
    expect(problemOf(sb)).toContain('unhandled errors');
  });

  it('fails without a rerun when the summary counts more failed files than the output names', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    fullOutput(sb, ` FAIL  ${FILES[0]} > suite > case\n Test Files  2 failed | 1 passed (3)\n`);
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(false);
    expect(aloneCalls(sb, FILES[0], 'branch')).toBe(0);
    expect(problemOf(sb)).toContain('counts 2 failed test files and the output names 1');
  });

  it('is pre-existing only when the base fails exactly the tests the branch fails', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, {
      failed: [FILES[0], FILES[1], FILES[2]],
      branch: {
        [FILES[0]]: ['1 first;second'],
        [FILES[1]]: ['1 first'],
        [FILES[2]]: ['1 SUITE'],
      },
      base: {
        [FILES[0]]: ['1 first'],
        [FILES[1]]: ['1 first;second'],
        [FILES[2]]: ['1 SUITE'],
      },
    });
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(false);
    // The base fails more tests than the branch (FILES[1]) or other ones (FILES[0]).
    expect(realFailures(sb)).toBe(`${FILES[0]}\n${FILES[1]}\n`);
    const log = readFileSync(join(sb.sync, 'checks.log'), 'utf-8');
    expect(log).toContain(`${FILES[0]} > second`);
    expect(log).toContain(`${FILES[1]} > second`);
    expect(log).toContain('only on the base');
    expect(log).toContain('only on the branch');
  });

  it('does not count a rerun that ran another file than the one asked for', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, { failed: [FILES[0]] });
    writeFileSync(join(sb.scenario, 'branch', `${FILES[0].replace(/\//g, '_')}.other`), '');
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(false);
    expect(realFailures(sb)).toBe(`${FILES[0]}\n`);
  });

  it('lets the report decide when another file matched by the filter made the exit code fail', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, { failed: [FILES[0]], branch: { [FILES[0]]: ['1 OTHER'] } });
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(true);
    expect(json.warnings[0].warning).toContain('flaky under load');
  });

  it('does not count a rerun with unhandled errors as a pass, even when its report is clean', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, { failed: [FILES[0]], branch: { [FILES[0]]: ['1 UNHANDLED'] } });
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(false);
    expect(realFailures(sb)).toBe(`${FILES[0]}\n`);
    expect(aloneCalls(sb, FILES[0], 'base')).toBe(0);
  });

  it('prunes the record of a base worktree that an earlier run left behind', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    const stale = join(sb.sync, 'base-worktree');
    git(sb, work, 'worktree', 'add', '--detach', stale, 'HEAD');
    rmSync(stale, { recursive: true, force: true });
    scenario(sb, { failed: [FILES[0]], branch: { [FILES[0]]: [1] }, base: { [FILES[0]]: [1] } });
    const { json } = vitest(sb, work);
    expect(json.passed).toBe(true);
    expect(json.warnings[0].warning).toContain('pre-existing');
  });

  it('counts a failed file as a failure when the extra time budget is used up', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    scenario(sb, { failed: [FILES[0]] });
    const { json } = vitest(sb, work, { VITEST_RERUN_BUDGET_SECONDS: '0' });
    expect(json.passed).toBe(false);
    expect(aloneCalls(sb, FILES[0], 'branch')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// final-checks.sh: the warnings reach the resolution notes
// ---------------------------------------------------------------------------

describe('final-checks.sh warnings (executable)', () => {
  setDefaultTimeout(60_000);
  const FILE = 'server/a.test.ts';

  /** A branch with one merge commit on top of base_sha, as resolve leaves it. */
  function mergedRepo(sb: Sandbox): string {
    const work = join(sb.root, 'work');
    mkdirSync(join(work, 'server'), { recursive: true });
    git(sb, work, 'init', '-q', '-b', 'main');
    writeFileSync(join(work, FILE), 'test\n');
    git(sb, work, 'add', '.');
    git(sb, work, 'commit', '-q', '-m', 'base');
    const baseSha = git(sb, work, 'rev-parse', 'HEAD');
    git(sb, work, 'checkout', '-q', '-b', 'upstream-side');
    writeFileSync(join(work, 'upstream.txt'), 'u\n');
    git(sb, work, 'add', '.');
    git(sb, work, 'commit', '-q', '-m', 'upstream');
    const upstreamSha = git(sb, work, 'rev-parse', 'HEAD');
    git(sb, work, 'checkout', '-q', 'main');
    git(sb, work, 'checkout', '-q', '-b', 'sync/upstream-1');
    git(
      sb,
      work,
      'merge',
      '-q',
      '--no-ff',
      '-m',
      `Merge milind-soni/OpenMausBot ${upstreamSha.slice(0, 9)} into main`,
      upstreamSha
    );
    const prepare = bashOf('prepare');
    const scripts = [
      ['checks.sh', 'CHECKS_SH'],
      ['clean-tree.sh', 'CLEAN_TREE_SH'],
      ['merge-commit.sh', 'MERGE_COMMIT_SH'],
      ['final-checks.sh', 'FINAL_CHECKS_SH'],
    ] as const;
    for (const [file, tag] of scripts) {
      writeFileSync(join(sb.sync, file), heredoc(prepare, tag));
    }
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({
        base_sha: baseSha,
        upstream_sha: upstreamSha,
        upstream_repo: 'milind-soni/OpenMausBot',
        fork_ref: 'main',
        branch: 'sync/upstream-1',
        files: [],
        failed_checks: [],
      })
    );
    writeFileSync(join(sb.sync, 'resolution.md'), 'The merge was clean.\n');
    writeFileSync(
      join(sb.scenario, 'full.out'),
      ` FAIL  ${FILE} > suite > case\n Test Files  1 failed | 2 passed (3)\n`
    );
    writeFileSync(join(sb.scenario, 'full.code'), '1');
    return work;
  }

  const finalChecks = (sb: Sandbox, work: string): RunResult =>
    run(sb, `bash "${join(sb.sync, 'final-checks.sh')}" test`, work);
  const notesOf = (sb: Sandbox): string => readFileSync(join(sb.sync, 'resolution.md'), 'utf-8');

  it('adds one warning paragraph to the resolution notes and keeps it single on a rerun', () => {
    const sb = makeSandbox();
    const work = mergedRepo(sb);
    expect(finalChecks(sb, work).status).toBe(0);
    expect(finalChecks(sb, work).status).toBe(0);
    const notes = notesOf(sb);
    expect(notes.match(/Local check warnings/g)?.length).toBe(1);
    expect(notes).toContain('The merge was clean.');
    expect(notes).toContain('the GitHub CI of this pull request is the authoritative gate');
    expect(notes).toContain(
      `- \`test-vitest\`: flaky under load (failed in the full run, passed alone on the branch): ${FILE}`
    );
  });

  it('removes the warning paragraph once nothing warns any more', () => {
    const sb = makeSandbox();
    const work = mergedRepo(sb);
    expect(finalChecks(sb, work).status).toBe(0);
    writeFileSync(join(sb.scenario, 'full.out'), ' Test Files  1 passed\n');
    writeFileSync(join(sb.scenario, 'full.code'), '0');
    expect(finalChecks(sb, work).status).toBe(0);
    expect(notesOf(sb)).not.toContain('Local check warnings');
  });

  it('tells the fix pass when the suite failed without a file list', () => {
    const sb = makeSandbox();
    const work = mergedRepo(sb);
    writeFileSync(
      join(sb.scenario, 'full.out'),
      ` FAIL  ${FILE} > suite > case\n Test Files  1 failed | 2 passed (3)\n      Errors  1 error\n`
    );
    expect(finalChecks(sb, work).status).toBe(10);
    const problems = readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8');
    expect(problems).toContain('the vitest suite failed without a usable file list');
    expect(problems).toContain('unhandled errors');
    expect(problems).toContain('checks.log');
  });

  it('reports only the real failures as problems', () => {
    const sb = makeSandbox();
    const work = mergedRepo(sb);
    writeFileSync(join(sb.scenario, 'branch', FILE.replace(/\//g, '_')), '1\n');
    expect(finalChecks(sb, work).status).toBe(10);
    const problems = readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8');
    expect(problems).toContain('local checks fail: test-vitest');
    expect(problems).toContain(`vitest test files that count as failures: ${FILE}`);
    expect(notesOf(sb)).not.toContain('Local check warnings');
  });
});
