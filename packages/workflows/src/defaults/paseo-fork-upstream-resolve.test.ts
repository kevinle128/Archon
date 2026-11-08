/**
 * Tests for the bundled `paseo-fork-upstream-resolve` workflow and its commands.
 *
 * The bash bodies are executed for real: each test renders a node through the same
 * substitution functions the executor uses (`substituteWorkflowVariables` with
 * `shellSafe`, then `substituteNodeOutputRefs` with bash quoting) and runs it with
 * fake `gh`, `git` network commands, `sleep`, `node`, `npm` and `npx` on PATH. No
 * test reaches the network: the fake `git` blocks every fetch or push it does not
 * redirect to a local repository, and the fake `gh` fails on any unexpected call.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
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
import { dirname, join } from 'node:path';
import { parseWorkflow } from '../loader';
import {
  buildTopologicalLayers,
  checkTriggerRule,
  substituteNodeOutputRefs,
} from '../dag-executor';
import { substituteWorkflowVariables } from '../executor-shared';
import { evaluateCondition } from '../condition-evaluator';
import type { DagNode, NodeOutput, WorkflowDefinition } from '../schemas';
import { BUNDLED_COMMANDS, BUNDLED_WORKFLOWS } from './bundled-defaults';

const NAME = 'paseo-fork-upstream-resolve';
const COMMAND_NAMES = [
  'paseo-fork-resolve-upstream-merge',
  'paseo-fork-fix-checks',
  'paseo-fork-fix-ci',
] as const;
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const YAML_PATH = join(REPO_ROOT, '.archon/workflows/defaults', `${NAME}.yaml`);
const YAML_TEXT = readFileSync(YAML_PATH, 'utf-8');
const RUN_ID = 'abcdef0123456789abcdef0123456789';
const FORK_REPO = 'kevinle128/paseo';
const ISSUE = 42;
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
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

function loopGroupOf(id: string): {
  until_bash?: string;
  max_iterations: number;
  nodes: DagNode[];
} {
  const node = nodeById(id) as {
    loop_group?: { until_bash?: string; max_iterations: number; nodes: DagNode[] };
  };
  if (!node.loop_group) throw new Error(`node ${id} is not a loop_group`);
  return node.loop_group;
}

/** Text between `# BEGIN <name>` and `# END <name>` markers. */
function region(text: string, name: string): string {
  const start = text.indexOf(`# BEGIN ${name}`);
  const end = text.indexOf(`# END ${name}`);
  if (start < 0 || end <= start) throw new Error(`markers for ${name} missing`);
  return text.slice(start, end);
}

/** The body of a quoted heredoc `<<'TAG'` ... `TAG` inside a node's bash. */
function heredoc(text: string, tag: string): string {
  const open = `<<'${tag}'\n`;
  const start = text.indexOf(open);
  const end = text.indexOf(`\n${tag}\n`, start);
  if (start < 0 || end < 0) throw new Error(`heredoc ${tag} missing`);
  return text.slice(start + open.length, end + 1);
}

/** Render a shell body the way the executor does for bash nodes and until_bash. */
function render(
  body: string,
  artifactsDir: string,
  outputs: Record<string, NodeOutput> = {}
): string {
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
  return substituteNodeOutputRefs(prompt, new Map(Object.entries(outputs)), true);
}

function completed(value: unknown, declaredFields?: string[]): NodeOutput {
  return {
    state: 'completed',
    output: JSON.stringify(value),
    ...(declaredFields ? { structuredOutput: value, declaredFields } : {}),
  };
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
  env: NodeJS.ProcessEnv;
}

const sandboxes: string[] = [];

const FAKE_GH = `#!/bin/bash
printf '%s\\n' "gh $*" >> "$FAKE_LOG"
case "$1 $2" in
  "repo view") printf '%s\\n' "$FAKE_REPO" ;;
  "issue view") cat "$FAKE_ISSUE_JSON" ;;
  "pr list") cat "$FAKE_PR_LIST_JSON" ;;
  "issue comment")
    for a in "$@"; do if [ "$prev" = --body-file ]; then cat "$a" >> "$FAKE_LOG.bodies"; fi; prev=$a; done
    echo "https://github.com/$FAKE_REPO/issues/1#issuecomment-1" ;;
  "pr comment")
    for a in "$@"; do if [ "$prev" = --body-file ]; then cat "$a" >> "$FAKE_LOG.bodies"; fi; prev=$a; done
    echo "https://github.com/$FAKE_REPO/pull/77#issuecomment-2" ;;
  "pr create") echo "https://github.com/$FAKE_REPO/pull/77" ;;
  "pr view")
    case "$*" in
      *headRefOid*) printf '%s\\n' "$FAKE_PR_HEAD" ;;
      *) echo 77 ;;
    esac ;;
  "pr checks")
    n=$(( $(cat "$FAKE_CHECKS_DIR/count" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$FAKE_CHECKS_DIR/count"
    while [ "$n" -gt 1 ] && [ ! -f "$FAKE_CHECKS_DIR/$n.out" ]; do n=$((n - 1)); done
    cat "$FAKE_CHECKS_DIR/$n.out"
    exit "$(cat "$FAKE_CHECKS_DIR/$n.code")" ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 99 ;;
esac
`;

// Network git commands are blocked unless a local repository stands in for the
// remote; every other git command runs the real git.
const FAKE_GIT = `#!/bin/bash
case "$1" in
  fetch)
    printf '%s\\n' "git $*" >> "$FAKE_LOG"
    if [ -z "\${FAKE_UPSTREAM_DIR:-}" ]; then echo "fake git: network fetch blocked" >&2; exit 97; fi
    shift
    args=()
    for a in "$@"; do
      case "$a" in
        https://github.com/getpaseo/paseo.git) a="$FAKE_UPSTREAM_DIR" ;;
        origin) a="$FAKE_ORIGIN_DIR" ;;
      esac
      args+=("$a")
    done
    exec "${REAL_GIT}" fetch "\${args[@]}" ;;
  push)
    printf '%s\\n' "git $*" >> "$FAKE_LOG"
    if [ "\${FAKE_GIT_ALLOW_PUSH:-}" = 1 ]; then exit 0; fi
    echo "fake git: network push blocked" >&2; exit 97 ;;
  pull|clone|ls-remote)
    echo "fake git: network command blocked" >&2; exit 97 ;;
esac
exec "${REAL_GIT}" "$@"
`;

const FAKE_SLEEP = `#!/bin/bash
printf '%s\\n' "sleep $*" >> "$FAKE_LOG"
`;

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'paseo-fork-resolve-'));
  sandboxes.push(root);
  const bin = join(root, 'bin');
  const artifacts = join(root, 'artifacts');
  const sync = join(artifacts, 'sync');
  mkdirSync(bin, { recursive: true });
  mkdirSync(sync, { recursive: true });
  mkdirSync(join(root, 'checks'), { recursive: true });
  writeExecutable(join(bin, 'gh'), FAKE_GH);
  writeExecutable(join(bin, 'git'), FAKE_GIT);
  writeExecutable(join(bin, 'sleep'), FAKE_SLEEP);
  const gitConfig = join(root, 'gitconfig');
  writeFileSync(gitConfig, '[init]\n\tdefaultBranch = main\n');
  const log = join(root, 'calls.log');
  writeFileSync(log, '');
  return {
    root,
    bin,
    artifacts,
    sync,
    log,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: root,
      ARTIFACTS_DIR: artifacts,
      WORKFLOW_ID: RUN_ID,
      ARCHON_PUBLIC_URL: 'https://archon.example.test/',
      FAKE_LOG: log,
      FAKE_REPO: FORK_REPO,
      FAKE_ISSUE_JSON: join(root, 'issue.json'),
      FAKE_PR_LIST_JSON: join(root, 'pr-list.json'),
      FAKE_CHECKS_DIR: join(root, 'checks'),
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.test',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.test',
    },
  };
}

afterAll(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

function run(
  sb: Sandbox,
  script: string,
  options: { cwd?: string; args?: string[]; env?: NodeJS.ProcessEnv } = {}
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('bash', ['-c', script, 'node', ...(options.args ?? [])], {
    cwd: options.cwd ?? sb.root,
    env: { ...sb.env, ...options.env },
    encoding: 'utf8',
    timeout: 20_000,
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

function blockLine(overrides: Record<string, unknown> = {}): string {
  const block = {
    schema: 1,
    label: 'upstream-sync-conflict',
    test: false,
    upstream_repo: 'getpaseo/paseo',
    upstream_sha: SHA_A,
    fork_repo: FORK_REPO,
    fork_ref: 'main',
    fork_sha: SHA_B,
    merge_base: SHA_C,
    files: ['packages/app/src/grid.tsx'],
    run_url: 'https://github.com/kevinle128/paseo/actions/runs/1',
    detected: '2026-11-08',
    ...overrides,
  };
  return `<!-- fork-sync-conflict:v1 ${JSON.stringify(block)} -->`;
}

function issueJson(body: string, labels: string[], state = 'OPEN'): string {
  return JSON.stringify({
    number: ISSUE,
    state,
    title: 'Upstream sync conflict: 1 file (upstream aaaaaaaaa)',
    labels: labels.map(name => ({ name })),
    url: `https://github.com/${FORK_REPO}/issues/${ISSUE}`,
    body,
  });
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('paseo-fork-upstream-resolve structure', () => {
  it('loads with the real loader without warnings', () => {
    const result = parseWorkflow(YAML_TEXT, `${NAME}.yaml`);
    expect(result.error).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('has the expected nodes, trigger rules and returns node', () => {
    expect(WORKFLOW.nodes.map(n => n.id)).toEqual([
      'read-request',
      'prepare',
      'resolve',
      'verify',
      'fix',
      'decide',
      'ask-human',
      'apply-guidance',
      'final-verify',
      'publish',
      'wait-ci',
      'fix-ci',
      'finalize',
    ]);
    const rules = Object.fromEntries(
      WORKFLOW.nodes.map(n => [n.id, n.trigger_rule ?? 'all_success'])
    );
    expect(rules).toEqual({
      'read-request': 'all_success',
      prepare: 'all_success',
      resolve: 'all_success',
      verify: 'all_success',
      fix: 'all_success',
      decide: 'none_failed_min_one_success',
      'ask-human': 'all_success',
      'apply-guidance': 'all_success',
      'final-verify': 'none_failed_min_one_success',
      publish: 'all_success',
      'wait-ci': 'all_success',
      'fix-ci': 'all_success',
      finalize: 'all_done',
    });
    expect(nodeById('decide').depends_on).toEqual(['resolve', 'verify', 'fix']);
    expect(nodeById('final-verify').depends_on).toEqual(['decide', 'apply-guidance']);
    expect(nodeById('finalize').depends_on).toEqual(['wait-ci', 'fix-ci']);
    expect(WORKFLOW.returns).toBe('finalize');
  });

  it('declares no workflow input, interactive flag, provider or model', () => {
    expect(WORKFLOW.inputs).toBeUndefined();
    expect(WORKFLOW.interactive).toBeUndefined();
    expect(WORKFLOW.provider).toBeUndefined();
    expect(WORKFLOW.model).toBeUndefined();
    expect(YAML_TEXT).not.toContain('INPUTS_');
  });

  it('reads the issue number with a structured AI node on the install default model', () => {
    const node = nodeById('read-request') as DagNode & {
      prompt?: string;
      output_format?: { properties?: Record<string, { type?: string }> };
    };
    // A model tier resolves per install, and the built-in tier default can name a
    // model the install's provider account cannot use; the default model always works.
    expect(node.model).toBeUndefined();
    expect(node.prompt).toContain('$ARGUMENTS');
    expect(node.output_format?.properties?.issue_number?.type).toBe('integer');
  });

  it('uses an approval gate without on_reject, so a reject cancels the run', () => {
    const node = nodeById('ask-human') as DagNode & {
      approval?: { capture_response?: boolean; on_reject?: unknown };
    };
    expect(node.approval?.capture_response).toBe(true);
    expect(node.approval?.on_reject).toBeUndefined();
    expect(node.when).toBe("$decide.output.needs_human == 'true'");
    const guidance = nodeById('apply-guidance') as DagNode & {
      command?: string;
      prompt_suffix?: string;
    };
    expect(guidance.command).toBe('paseo-fork-resolve-upstream-merge');
    expect(guidance.prompt_suffix).toContain('$ask-human.output');
  });

  it('fixes CI in a bounded loop group that ends before max_iterations', () => {
    const group = loopGroupOf('fix-ci');
    expect(group.max_iterations).toBe(3);
    expect(group.nodes.map(n => n.id)).toEqual(['fix-ci-attempt', 'wait-ci-again']);
    expect(nodeById('fix-ci').when).toBe("$wait-ci.output.conclusion == 'failure'");
    expect(group.until_bash).toContain('.attempt >= 2');
  });

  it('gives every slow bash node an explicit timeout', () => {
    const timeouts = Object.fromEntries(
      ['prepare', 'verify', 'decide', 'final-verify', 'publish', 'wait-ci', 'finalize'].map(id => [
        id,
        nodeById(id).timeout,
      ])
    );
    expect(timeouts).toEqual({
      prepare: 1_800_000,
      verify: 2_700_000,
      decide: 2_700_000,
      'final-verify': 2_700_000,
      publish: 600_000,
      'wait-ci': 6_000_000,
      finalize: 300_000,
    });
    expect(loopGroupOf('fix-ci').nodes[1]?.timeout).toBe(6_000_000);
  });

  it('is bundled with its three commands', () => {
    expect(BUNDLED_WORKFLOWS[NAME]).toBe(YAML_TEXT.replace(/\r\n/g, '\n'));
    for (const name of COMMAND_NAMES) {
      const disk = readFileSync(
        join(REPO_ROOT, '.archon/commands/defaults', `${name}.md`),
        'utf-8'
      );
      expect(BUNDLED_COMMANDS[name]).toBe(disk.replace(/\r\n/g, '\n'));
    }
  });
});

// ---------------------------------------------------------------------------
// Policy: no merge, no issue close, bounded checks, branch and PR shape
// ---------------------------------------------------------------------------

describe('paseo-fork-upstream-resolve policy', () => {
  const allText = [YAML_TEXT, ...COMMAND_NAMES.map(n => BUNDLED_COMMANDS[n] ?? '')];

  it('never merges a pull request and never uses auto, squash or rebase merges', () => {
    for (const text of allText) {
      expect(text).not.toContain('gh pr merge');
      expect(text).not.toContain('--auto');
      expect(text).not.toContain('--squash');
      expect(text).not.toContain('--rebase');
    }
  });

  it('never closes the issue', () => {
    for (const text of allText) expect(text).not.toContain('gh issue close');
  });

  it('never runs the full test suite or Playwright from the workflow', () => {
    expect(YAML_TEXT).not.toMatch(/npm run test\b|npm test\b|playwright/i);
    // The commands name the forbidden commands only to forbid them.
    for (const name of COMMAND_NAMES) {
      for (const line of (BUNDLED_COMMANDS[name] ?? '').split('\n')) {
        if (/npm run test\b|npm test\b|playwright/i.test(line)) expect(line).toMatch(/Never/);
      }
    }
  });

  it('makes one branch per attempt from the issue number and the run id', () => {
    expect(bashOf('prepare')).toContain('branch="sync/upstream-$issue-${WORKFLOW_ID:0:8}"');
  });

  it('opens the pull request against the validated fork_ref, never a literal main', () => {
    const publish = bashOf('publish');
    expect(publish).toContain('--base "$fork_ref"');
    expect(publish).not.toMatch(/--base\s+["']?main\b/);
    expect(publish).toContain('Closes #');
    expect(publish).toContain('Merge with **Create a merge commit**, not squash.');
    expect(publish).toContain('--title "sync: merge upstream $upstream_repo $(date +%F)"');
  });

  it('waits for CI with gh pr checks inside the documented windows', () => {
    const script = heredoc(bashOf('wait-ci'), 'WAIT_CI_SH');
    expect(script).toContain('gh pr checks');
    expect(script).toContain('poll_seconds=60');
    expect(script).toContain('first_check_polls=10');
    expect(script).toContain('max_polls=90');
  });
});

// ---------------------------------------------------------------------------
// Trigger rules and when: run in executor order (trigger rule first)
// ---------------------------------------------------------------------------

type Decision = 'run' | 'skip:trigger' | 'skip:when';

/**
 * Walk the DAG with the executor's own `checkTriggerRule` and `evaluateCondition`,
 * in the executor's order: the trigger rule first, then `when:`. A node that runs
 * gets the scenario's output (default: a completed empty object).
 */
function simulate(produced: Record<string, NodeOutput>): Record<string, Decision> {
  const outputs = new Map<string, NodeOutput>();
  const decisions: Record<string, Decision> = {};
  for (const layer of buildTopologicalLayers(WORKFLOW.nodes)) {
    for (const node of layer) {
      if (checkTriggerRule(node, outputs) === 'skip') {
        decisions[node.id] = 'skip:trigger';
        outputs.set(node.id, { state: 'skipped', output: '' });
        continue;
      }
      if (node.when !== undefined) {
        const { result, parsed } = evaluateCondition(node.when, outputs);
        expect(parsed).toBe(true);
        if (!result) {
          decisions[node.id] = 'skip:when';
          outputs.set(node.id, { state: 'skipped', output: '' });
          continue;
        }
      }
      decisions[node.id] = 'run';
      outputs.set(node.id, produced[node.id] ?? completed({}));
    }
  }
  return decisions;
}

describe('paseo-fork-upstream-resolve skip semantics', () => {
  const resolveOut = (resolved: boolean): NodeOutput =>
    completed({ resolved, question: resolved ? '' : 'Which side?' }, ['resolved', 'question']);

  it('skips verify and fix (not fails) when the resolver needs a human', () => {
    const d = simulate({
      resolve: resolveOut(false),
      decide: completed({ needs_human: true, question: 'q', issue_url: 'u', run_url: 'r' }),
      'wait-ci': completed({ conclusion: 'success' }),
    });
    expect(d.verify).toBe('skip:when');
    expect(d.fix).toBe('skip:trigger');
    expect(d.decide).toBe('run');
    expect(d['ask-human']).toBe('run');
    expect(d['apply-guidance']).toBe('run');
    expect(d['final-verify']).toBe('run');
  });

  it('skips the gate and the guidance pass when no human is needed', () => {
    const d = simulate({
      resolve: resolveOut(true),
      verify: completed({ passed: true, failed: [], ran: [], full: true }),
      decide: completed({ needs_human: false, question: '', issue_url: 'u', run_url: 'r' }),
      'wait-ci': completed({ conclusion: 'success' }),
    });
    expect(d.verify).toBe('run');
    expect(d.fix).toBe('skip:when');
    expect(d.decide).toBe('run');
    expect(d['ask-human']).toBe('skip:when');
    expect(d['apply-guidance']).toBe('skip:trigger');
    expect(d['final-verify']).toBe('run');
    expect(d.publish).toBe('run');
    expect(d['fix-ci']).toBe('skip:when');
    expect(d.finalize).toBe('run');
  });

  it('runs fix when verify reports failed checks, and fix-ci when CI fails', () => {
    const d = simulate({
      resolve: resolveOut(true),
      verify: completed({ passed: false, failed: ['lint'], ran: [], full: true }),
      decide: completed({ needs_human: false, question: '', issue_url: 'u', run_url: 'r' }),
      'wait-ci': completed({ conclusion: 'failure', failed: ['ci'], checks_url: 'x', attempt: 0 }),
    });
    expect(d.fix).toBe('run');
    expect(d['fix-ci']).toBe('run');
    expect(d.finalize).toBe('run');
  });

  it('still runs finalize, and only finalize, after prepare fails', () => {
    const d = simulate({
      prepare: { state: 'failed', output: '', error: 'refused' },
    });
    for (const id of [
      'resolve',
      'verify',
      'fix',
      'decide',
      'ask-human',
      'apply-guidance',
      'final-verify',
      'publish',
      'wait-ci',
      'fix-ci',
    ]) {
      expect(d[id]).toBe('skip:trigger');
    }
    expect(d.finalize).toBe('run');
  });

  it('still runs finalize after final-verify fails', () => {
    const d = simulate({
      resolve: resolveOut(true),
      verify: completed({ passed: true, failed: [], ran: [], full: true }),
      decide: completed({ needs_human: false, question: '', issue_url: 'u', run_url: 'r' }),
      'final-verify': { state: 'failed', output: '', error: 'checks fail' },
    });
    expect(d.publish).toBe('skip:trigger');
    expect(d['wait-ci']).toBe('skip:trigger');
    expect(d['fix-ci']).toBe('skip:trigger');
    expect(d.finalize).toBe('run');
  });
});

// ---------------------------------------------------------------------------
// Issue block parser and test guard
// ---------------------------------------------------------------------------

describe('fork-sync-conflict block validation (executable)', () => {
  let sb: Sandbox;
  const checks = region(bashOf('prepare'), 'sync-request-checks');

  beforeAll(() => {
    sb = makeSandbox();
  });

  function validate(
    body: string,
    labels: string[],
    repo = FORK_REPO
  ): { status: number | null; block: Record<string, unknown> | null; refusal: string } {
    const bodyFile = join(sb.root, 'body.md');
    writeFileSync(bodyFile, body);
    rmSync(join(sb.sync, 'refusal.txt'), { force: true });
    const result = run(sb, `set -euo pipefail\n${checks}\nvalidate_sync_block "$1" "$2" "$3"`, {
      args: [bodyFile, repo, JSON.stringify(labels)],
    });
    const refusalPath = join(sb.sync, 'refusal.txt');
    let block: Record<string, unknown> | null = null;
    if (result.status === 0) block = JSON.parse(result.stdout) as Record<string, unknown>;
    return {
      status: result.status,
      block,
      refusal: existsSync(refusalPath) ? readFileSync(refusalPath, 'utf-8').trim() : '',
    };
  }

  const PROD_LABELS = ['upstream-sync-conflict'];
  const TEST_LABELS = ['upstream-sync-conflict', 'sync-test'];
  const TEST_BASE = 'sync-test/20261108-1-base';

  it('accepts a valid production block', () => {
    const r = validate(`${blockLine()}\n\n## Upstream sync conflict\n`, PROD_LABELS);
    expect(r.status).toBe(0);
    expect(r.refusal).toBe('');
    expect(r.block?.upstream_sha).toBe(SHA_A);
    expect(r.block?.fork_ref).toBe('main');
  });

  it('accepts a valid test block with the sync-test label and a sync-test base', () => {
    const r = validate(blockLine({ test: true, fork_ref: TEST_BASE }), TEST_LABELS);
    expect(r.status).toBe(0);
    expect(r.block?.fork_ref).toBe(TEST_BASE);
  });

  it('accepts CRLF line endings and file names with escaped comment markers', () => {
    const line = blockLine({ files: ['a-->b<c>.txt'] })
      .replace('a-->b<c>.txt', 'a--\\u003eb\\u003cc\\u003e.txt')
      .concat('\r\n');
    const r = validate(line, PROD_LABELS);
    expect(r.status).toBe(0);
    expect(r.block?.files).toEqual(['a-->b<c>.txt']);
  });

  const refusals: Array<[string, string, string[], string]> = [
    [
      'a body without the block',
      '## Upstream sync conflict\n',
      PROD_LABELS,
      'line 1 of the issue body is not a fork-sync-conflict:v1 block',
    ],
    [
      'a block on line 2',
      `intro\n${blockLine()}\n`,
      PROD_LABELS,
      'line 1 of the issue body is not a fork-sync-conflict:v1 block',
    ],
    [
      'a block that is not JSON',
      '<!-- fork-sync-conflict:v1 {nope -->\n',
      PROD_LABELS,
      'is not a JSON object',
    ],
    ['a wrong schema', blockLine({ schema: 2 }), PROD_LABELS, 'schema must be 1'],
    [
      'a wrong label',
      blockLine({ label: 'other' }),
      PROD_LABELS,
      'label must be "upstream-sync-conflict"',
    ],
    [
      'another upstream repository',
      blockLine({ upstream_repo: 'evil/paseo' }),
      PROD_LABELS,
      'upstream_repo must be "getpaseo/paseo"',
    ],
    [
      'a short upstream SHA',
      blockLine({ upstream_sha: 'aaaaaaaaa' }),
      PROD_LABELS,
      'upstream_sha must be 40 lowercase hex characters',
    ],
    [
      'an uppercase fork SHA',
      blockLine({ fork_sha: 'B'.repeat(40) }),
      PROD_LABELS,
      'fork_sha must be 40 lowercase hex characters',
    ],
    [
      'a missing merge base',
      blockLine({ merge_base: undefined }),
      PROD_LABELS,
      'merge_base must be 40 lowercase hex characters',
    ],
    [
      'a fork_repo of another repository',
      blockLine({ fork_repo: 'someone/paseo' }),
      PROD_LABELS,
      `fork_repo must be "${FORK_REPO}"`,
    ],
    [
      'a feature branch as fork_ref',
      blockLine({ fork_ref: 'feature/x' }),
      PROD_LABELS,
      'fork_ref must be "main" or sync-test/<yyyymmdd>-<n>-base',
    ],
    [
      'a test block without the sync-test label',
      blockLine({ test: true, fork_ref: TEST_BASE }),
      PROD_LABELS,
      'test is true but the issue has no sync-test label',
    ],
    [
      'the sync-test label on a production block',
      blockLine(),
      TEST_LABELS,
      'the issue has the sync-test label but test is false',
    ],
    [
      'a test base with test false',
      blockLine({ fork_ref: TEST_BASE }),
      PROD_LABELS,
      'fork_ref is a sync-test/ base but test is false',
    ],
    [
      'a test block that targets main',
      blockLine({ test: true }),
      TEST_LABELS,
      'test is true but fork_ref is not a sync-test/ base',
    ],
    [
      'a non-boolean test flag',
      blockLine({ test: 'false' }),
      PROD_LABELS,
      'test must be a boolean',
    ],
    [
      'files that are not strings',
      blockLine({ files: [1] }),
      PROD_LABELS,
      'files must be an array of strings',
    ],
  ];

  for (const [label, body, labels, reason] of refusals) {
    it(`refuses ${label} and records the reason`, () => {
      const r = validate(body, labels);
      expect(r.status).toBe(1);
      expect(r.refusal).toContain(reason);
    });
  }

  it('lists every reason when several fields are wrong', () => {
    const r = validate(blockLine({ schema: 3, fork_ref: 'feature/x' }), PROD_LABELS);
    expect(r.status).toBe(1);
    expect(r.refusal).toContain('schema must be 1; ');
    expect(r.refusal).toContain('fork_ref must be');
  });
});

// ---------------------------------------------------------------------------
// prepare (whole node)
// ---------------------------------------------------------------------------

interface ForkRepos {
  work: string;
  origin: string;
  upstream: string;
  upstreamSha: string;
  forkSha: string;
  mergeBase: string;
}

/** A fork (origin), an upstream and a work clone; every file in `files` conflicts. */
function makeForkRepos(sb: Sandbox, files: string[] = ['src/grid.ts']): ForkRepos {
  const origin = join(sb.root, 'origin');
  const upstream = join(sb.root, 'upstream');
  const work = join(sb.root, 'work');
  const writeAll = (repo: string, content: string): void => {
    for (const file of files) {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), `export const grid = "${content}";\n`);
    }
  };
  mkdirSync(origin, { recursive: true });
  git(sb, origin, 'init', '-q', '-b', 'main');
  writeAll(origin, 'base');
  mkdirSync(join(origin, 'src'), { recursive: true });
  writeFileSync(join(origin, 'src/grid.test.ts'), 'test\n');
  git(sb, origin, 'add', '.');
  git(sb, origin, 'commit', '-q', '-m', 'base');
  const mergeBase = git(sb, origin, 'rev-parse', 'HEAD');
  git(sb, sb.root, 'clone', '-q', origin, upstream);
  writeAll(upstream, 'upstream');
  git(sb, upstream, 'commit', '-q', '-am', 'upstream change');
  const upstreamSha = git(sb, upstream, 'rev-parse', 'HEAD');
  writeAll(origin, 'fork');
  git(sb, origin, 'commit', '-q', '-am', 'fork change');
  const forkSha = git(sb, origin, 'rev-parse', 'HEAD');
  git(sb, sb.root, 'clone', '-q', origin, work);
  git(sb, work, 'remote', 'set-url', 'origin', `https://github.com/${FORK_REPO}.git`);
  return { work, origin, upstream, upstreamSha, forkSha, mergeBase };
}

describe('prepare node (executable)', () => {
  function runPrepare(
    sb: Sandbox,
    repos: ForkRepos | null,
    options: {
      issueNumber?: number;
      body?: string;
      labels?: string[];
      state?: string;
      openPrs?: unknown[];
      files?: string[];
    }
  ): { status: number | null; stdout: string; stderr: string } {
    const body =
      options.body ??
      `${blockLine(
        repos
          ? {
              upstream_sha: repos.upstreamSha,
              fork_sha: repos.forkSha,
              merge_base: repos.mergeBase,
              files: options.files ?? ['src/grid.ts'],
            }
          : {}
      )}\n\n## Upstream sync conflict\n`;
    writeFileSync(
      sb.env.FAKE_ISSUE_JSON as string,
      issueJson(body, options.labels ?? ['upstream-sync-conflict'], options.state)
    );
    writeFileSync(sb.env.FAKE_PR_LIST_JSON as string, JSON.stringify(options.openPrs ?? []));
    const script = render(bashOf('prepare'), sb.artifacts, {
      'read-request': completed({ issue_number: options.issueNumber ?? ISSUE }, ['issue_number']),
    });
    let cwd = sb.root;
    if (repos) cwd = repos.work;
    else {
      const work = join(sb.root, 'work');
      mkdirSync(work, { recursive: true });
      git(sb, work, 'init', '-q', '-b', 'main');
      git(sb, work, 'remote', 'add', 'origin', `https://github.com/${FORK_REPO}.git`);
      cwd = work;
    }
    return run(sb, script, {
      cwd,
      env: repos ? { FAKE_UPSTREAM_DIR: repos.upstream, FAKE_ORIGIN_DIR: repos.origin } : {},
    });
  }

  it('stops before any fetch or branch when the issue already has an open sync PR', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, {
      openPrs: [
        { headRefName: 'feature/other', url: 'https://github.com/x/y/pull/1' },
        { headRefName: `sync/upstream-${ISSUE}-1234abcd`, url: 'https://github.com/x/y/pull/9' },
      ],
    });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'refusal.txt'), 'utf-8')).toContain(
      `issue #${ISSUE} already has an open sync pull request: https://github.com/x/y/pull/9`
    );
    expect(existsSync(join(sb.sync, 'issue.json'))).toBe(true);
    expect(calls(sb).some(c => c.startsWith('git fetch'))).toBe(false);
    expect(calls(sb)).toContain(
      `gh pr list --repo ${FORK_REPO} --state open --limit 1000 --json headRefName,url`
    );
  });

  it('ignores open sync PRs of other issues', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, {
      openPrs: [{ headRefName: `sync/upstream-${ISSUE}0-1234abcd`, url: 'u' }],
    });
    // It passes the guard and reaches the upstream fetch, which the fake git blocks.
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'refusal.txt'), 'utf-8')).toContain(
      'cannot fetch main from https://github.com/getpaseo/paseo.git'
    );
  });

  it('records the refusal reason for an invalid block and fetches nothing', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, { body: blockLine({ fork_ref: 'feature/x' }) });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'refusal.txt'), 'utf-8')).toContain('fork_ref must be');
    expect(readJson<{ issue: number; run_url: string }>(join(sb.sync, 'issue.json'))).toEqual({
      repo: FORK_REPO,
      issue: ISSUE,
      issue_url: `https://github.com/${FORK_REPO}/issues/${ISSUE}`,
      run_url: `https://archon.example.test/runs/${RUN_ID}`,
    } as never);
    expect(calls(sb).some(c => c.startsWith('git fetch'))).toBe(false);
  });

  it('applies the test guard before fetching', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, {
      body: blockLine(),
      labels: ['upstream-sync-conflict', 'sync-test'],
    });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'refusal.txt'), 'utf-8')).toContain(
      'the issue has the sync-test label but test is false'
    );
    expect(calls(sb).some(c => c.startsWith('git fetch'))).toBe(false);
  });

  it('leaves a closed issue untouched (no identity file, no refusal)', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, { state: 'CLOSED' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is CLOSED, not OPEN');
    expect(existsSync(join(sb.sync, 'issue.json'))).toBe(false);
    expect(existsSync(join(sb.sync, 'refusal.txt'))).toBe(false);
  });

  it('leaves an issue without the conflict label untouched', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, { labels: ['bug'] });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('has no upstream-sync-conflict label');
    expect(existsSync(join(sb.sync, 'issue.json'))).toBe(false);
  });

  it('calls nothing when the message names no issue', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, { issueNumber: 0 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('names no single issue number');
    expect(calls(sb)).toEqual([]);
  });

  it('starts the merge on a new per-run branch and writes sync.json and checks.sh', () => {
    const sb = makeSandbox();
    const repos = makeForkRepos(sb);
    const r = runPrepare(sb, repos, {});
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const sync = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(sync).toEqual({
      repo: FORK_REPO,
      issue: ISSUE,
      issue_url: `https://github.com/${FORK_REPO}/issues/${ISSUE}`,
      upstream_repo: 'getpaseo/paseo',
      upstream_sha: repos.upstreamSha,
      fork_ref: 'main',
      fork_sha: repos.forkSha,
      merge_base: repos.mergeBase,
      branch: `sync/upstream-${ISSUE}-abcdef01`,
      files: ['src/grid.ts'],
      force_human: false,
      test: false,
    });
    expect(readJson<unknown>(join(sb.sync, 'sync.json'))).toEqual(sync);
    expect(git(sb, repos.work, 'symbolic-ref', '--short', 'HEAD')).toBe(
      `sync/upstream-${ISSUE}-abcdef01`
    );
    expect(git(sb, repos.work, 'rev-parse', 'MERGE_HEAD')).toBe(repos.upstreamSha);
    expect(existsSync(join(sb.sync, 'checks.sh'))).toBe(true);
    expect(readFileSync(join(sb.sync, 'issue.md'), 'utf-8')).toContain('## Upstream sync conflict');
  });

  it('marks force_human when the issue asks for a human review', () => {
    const sb = makeSandbox();
    const repos = makeForkRepos(sb);
    const r = runPrepare(sb, repos, {
      labels: ['upstream-sync-conflict', 'sync-force-human-review'],
    });
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { force_human: boolean }).force_human).toBe(true);
  });

  it('records conflicted paths with spaces, non-ASCII characters and a leading dash', () => {
    const sb = makeSandbox();
    const files = ['-dash.ts', 'src/naïve grid.ts'];
    const repos = makeForkRepos(sb, files);
    const r = runPrepare(sb, repos, { files });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { files: string[] }).files).toEqual(files);
  });

  it('refuses an upstream commit that the fork already contains', () => {
    const sb = makeSandbox();
    const repos = makeForkRepos(sb);
    const r = runPrepare(sb, repos, {
      body: blockLine({
        upstream_sha: repos.mergeBase,
        fork_sha: repos.forkSha,
        merge_base: repos.mergeBase,
      }),
    });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'refusal.txt'), 'utf-8')).toContain('started no merge');
  });
});

// ---------------------------------------------------------------------------
// Local checks script
// ---------------------------------------------------------------------------

describe('local checks script (executable)', () => {
  const CHECKS_SH = heredoc(bashOf('prepare'), 'CHECKS_SH');

  function setup(options: { failing?: string; nodeMajor?: string } = {}): {
    sb: Sandbox;
    work: string;
    script: string;
  } {
    const sb = makeSandbox();
    const work = join(sb.root, 'work');
    mkdirSync(join(work, 'src'), { recursive: true });
    git(sb, work, 'init', '-q', '-b', 'main');
    for (const f of [
      'grid.ts',
      'grid.test.ts',
      'grid.browser.test.tsx',
      'panel.tsx',
      'panel.test.tsx',
    ]) {
      writeFileSync(join(work, 'src', f), 'x\n');
    }
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({ files: ['src/grid.ts', 'src/panel.tsx', 'src/gone.ts'] })
    );
    const script = join(sb.sync, 'checks.sh');
    writeFileSync(script, CHECKS_SH);
    const failing = options.failing ?? '';
    // Fake toolchain: records every call; the named check fails.
    const fake = (tool: string): string => `#!/bin/bash
printf '%s\\n' "${tool} $*" >> "$FAKE_LOG"
printf '%s NODE_ENV=%s\\n' "${tool}" "\${NODE_ENV-unset}" >> "$FAKE_LOG.env"
if [ "$1" != -p ]; then printf '[%s]' "${tool}" "$@" >> "$FAKE_LOG.args"; echo >> "$FAKE_LOG.args"; fi
if [ "$1" = -p ]; then echo ${options.nodeMajor ?? '22'}; exit 0; fi
if [ "$1" = --version ]; then echo v${options.nodeMajor ?? '22'}.0.0; exit 0; fi
case "${tool} $*" in *"${failing || '__none__'}"*) echo "boom from ${tool}"; exit 1 ;; esac
exit 0
`;
    for (const tool of ['node', 'npm', 'npx']) writeExecutable(join(sb.bin, tool), fake(tool));
    return { sb, work, script };
  }

  it('runs the bounded check list and the tests beside conflicted files', () => {
    const { sb, work, script } = setup({ failing: 'run lint' });
    const r = run(sb, `bash "${script}"`, { cwd: work });
    expect(r.status).toBe(0);
    const result = JSON.parse(r.stdout) as {
      passed: boolean;
      failed: string[];
      ran: Array<{ name: string; status: string }>;
      full: boolean;
    };
    expect(result.passed).toBe(false);
    expect(result.failed).toEqual(['lint']);
    expect(result.full).toBe(true);
    expect(result.ran.map(c => c.name)).toEqual([
      'install',
      'build-server',
      'typecheck',
      'lint',
      'format-check',
      'fork-script-tests',
      'vitest:src/grid.test.ts',
      'vitest:src/panel.test.tsx',
    ]);
    expect(readJson<unknown>(join(sb.sync, 'checks.json'))).toEqual(result);
    expect(readFileSync(join(sb.sync, 'checks.log'), 'utf-8')).toContain('boom from npm');
    const toolCalls = calls(sb).filter(c => !c.startsWith('node -p'));
    expect(toolCalls).toEqual([
      'node scripts/npm-retry.mjs ci',
      'npm run build:server',
      'npm run typecheck',
      'npm run lint',
      'npm run format:check',
      'node --test scripts/fork-desktop-manifest.test.mjs scripts/fork-sync-conflict-report.test.mjs scripts/fork-release-changelog.test.mjs',
      'npx vitest run src/grid.test.ts --bail=1',
      'npx vitest run src/panel.test.tsx --bail=1',
    ]);
  });

  it('runs the checks without NODE_ENV, like the fork CI, even when the server sets production', () => {
    // A server started with NODE_ENV=production would make npm ci skip devDependencies
    // (patch-package, the type checker, the linter), so every check would fail.
    const { sb, work, script } = setup();
    const r = run(sb, `bash "${script}" install lint`, {
      cwd: work,
      env: { NODE_ENV: 'production' },
    });
    expect(r.status).toBe(0);
    const envLines = readFileSync(`${sb.env.FAKE_LOG}.env`, 'utf-8').trim().split('\n');
    expect(envLines.length).toBeGreaterThan(0);
    for (const line of envLines) expect(line).toEndWith('NODE_ENV=unset');
  });

  it('reruns only the named checks as a partial run', () => {
    const { sb, work, script } = setup();
    const r = run(sb, `bash "${script}" lint vitest:src/grid.test.ts`, { cwd: work });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      passed: true,
      failed: [],
      ran: [
        { name: 'lint', status: 'pass' },
        { name: 'vitest:src/grid.test.ts', status: 'pass' },
      ],
      full: false,
    });
  });

  it('passes conflicted paths with spaces, non-ASCII characters or a leading dash as one safe argument', () => {
    const { sb, work, script } = setup();
    for (const f of ['src/naïve grid.ts', 'src/naïve grid.test.ts', '-x/a.ts', '-x/a.test.ts']) {
      mkdirSync(dirname(join(work, f)), { recursive: true });
      writeFileSync(join(work, f), 'x\n');
    }
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({ files: ['src/naïve grid.ts', '-x/a.ts'] })
    );
    const r = run(sb, `bash "${script}"`, { cwd: work });
    expect(r.status).toBe(0);
    const ran = (JSON.parse(r.stdout) as { ran: Array<{ name: string }> }).ran.map(c => c.name);
    expect(ran.filter(n => n.startsWith('vitest:'))).toEqual([
      'vitest:./-x/a.test.ts',
      'vitest:src/naïve grid.test.ts',
    ]);
    const vitestCalls = readFileSync(`${sb.log}.args`, 'utf-8')
      .split('\n')
      .filter(line => line.startsWith('[npx]'));
    expect(vitestCalls).toEqual([
      '[npx][vitest][run][./-x/a.test.ts][--bail=1]',
      '[npx][vitest][run][src/naïve grid.test.ts][--bail=1]',
    ]);
  });

  it('rejects a vitest check name that would start with a dash', () => {
    const { sb, work, script } = setup();
    const r = run(sb, `bash "${script}" "vitest:-x/a.test.ts"`, { cwd: work });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown check 'vitest:-x/a.test.ts'");
    expect(calls(sb).some(c => c.startsWith('npx'))).toBe(false);
  });

  it('rejects unknown check names and browser tests', () => {
    const { sb, work, script } = setup();
    for (const name of ['test', 'vitest:src/grid.browser.test.tsx', 'vitest:src/grid.ts']) {
      const r = run(sb, `bash "${script}" "${name}"`, { cwd: work });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`unknown check '${name}'`);
    }
  });

  it('fails as a missing tool when Node is not version 22', () => {
    const { sb, work, script } = setup({ nodeMajor: '20' });
    const r = run(sb, `bash "${script}"`, { cwd: work });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Node 22 is required');
  });
});

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

describe('decide node (executable)', () => {
  function runDecide(
    sb: Sandbox,
    resolve: { resolved: boolean; question: string },
    options: { checks?: unknown; forceHuman?: boolean } = {}
  ): { status: number | null; stdout: string } {
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({
        repo: FORK_REPO,
        issue: ISSUE,
        issue_url: 'https://github.com/kevinle128/paseo/issues/42',
        force_human: options.forceHuman ?? false,
      })
    );
    writeFileSync(
      join(sb.sync, 'issue.json'),
      JSON.stringify({
        repo: FORK_REPO,
        issue: ISSUE,
        run_url: 'https://archon.example.test/runs/r',
      })
    );
    if (options.checks) writeFileSync(join(sb.sync, 'checks.json'), JSON.stringify(options.checks));
    const script = render(bashOf('decide'), sb.artifacts, {
      resolve: completed(resolve, ['resolved', 'question']),
    });
    return run(sb, script);
  }

  it('asks a human and comments once when the resolver cannot decide', () => {
    const sb = makeSandbox();
    const r = runDecide(sb, { resolved: false, question: "Keep the fork's `grid` or upstream's?" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      needs_human: true,
      question: "The resolver could not decide: Keep the fork's `grid` or upstream's?",
      issue_url: 'https://github.com/kevinle128/paseo/issues/42',
      run_url: 'https://archon.example.test/runs/r',
    });
    expect(calls(sb).filter(c => c.startsWith('gh issue comment'))).toHaveLength(1);
    expect(readFileSync(`${sb.log}.bodies`, 'utf-8')).toContain(
      'The sync stays paused until a sync pull request merges.'
    );
  });

  it('reuses a full passing check run and asks nobody', () => {
    const sb = makeSandbox();
    const r = runDecide(
      sb,
      { resolved: true, question: '' },
      { checks: { passed: true, failed: [], ran: [], full: true } }
    );
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { needs_human: boolean }).needs_human).toBe(false);
    expect(calls(sb)).toEqual([]);
    expect(readJson<{ passed: boolean }>(join(sb.sync, 'decision.json')).passed).toBe(true);
  });

  it('asks a human when the issue forces a review', () => {
    const sb = makeSandbox();
    const r = runDecide(
      sb,
      { resolved: true, question: '' },
      { checks: { passed: true, failed: [], ran: [], full: true }, forceHuman: true }
    );
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { needs_human: boolean }).needs_human).toBe(true);
    expect(calls(sb).filter(c => c.startsWith('gh issue comment'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// final-verify
// ---------------------------------------------------------------------------

describe('final-verify node (executable)', () => {
  function committedMerge(files: string[] = ['src/grid.ts']): { sb: Sandbox; repos: ForkRepos } {
    const sb = makeSandbox();
    const repos = makeForkRepos(sb, files);
    git(sb, repos.work, 'fetch', '-q', repos.origin, '+refs/heads/main:refs/remotes/origin/main');
    git(sb, repos.work, 'fetch', '-q', repos.upstream, 'main');
    git(sb, repos.work, 'switch', '-q', '-c', `sync/upstream-${ISSUE}-abcdef01`);
    spawnSync(REAL_GIT, ['merge', '--no-ff', '--no-commit', repos.upstreamSha], {
      cwd: repos.work,
      env: sb.env,
    });
    for (const file of files) {
      writeFileSync(join(repos.work, file), 'export const grid = "fork+upstream";\n');
      git(sb, repos.work, 'add', '--', file);
    }
    git(sb, repos.work, 'commit', '-q', '--no-edit');
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({
        upstream_sha: repos.upstreamSha,
        fork_ref: 'main',
        branch: `sync/upstream-${ISSUE}-abcdef01`,
        files,
      })
    );
    writeFileSync(
      join(sb.sync, 'checks.json'),
      JSON.stringify({ passed: true, failed: [], ran: [], full: true })
    );
    writeFileSync(
      join(sb.sync, 'decision.json'),
      JSON.stringify({ needs_human: false, passed: true })
    );
    return { sb, repos };
  }

  it('passes for a committed merge with notes for every conflicted file', () => {
    const { sb, repos } = committedMerge();
    writeFileSync(join(sb.sync, 'resolution.md'), '`src/grid.ts`: keeps both.\n');
    const r = run(sb, render(bashOf('final-verify'), sb.artifacts), { cwd: repos.work });
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { verified: boolean }).verified).toBe(true);
  });

  it('fails and records the problems when notes or markers are wrong', () => {
    const { sb, repos } = committedMerge();
    writeFileSync(join(sb.sync, 'resolution.md'), 'nothing about the file\n');
    writeFileSync(join(repos.work, 'src/grid.ts'), '<<<<<<< ours\nx\n>>>>>>> theirs\n');
    git(sb, repos.work, 'commit', '-q', '-am', 'bad');
    const r = run(sb, render(bashOf('final-verify'), sb.artifacts), { cwd: repos.work });
    expect(r.status).toBe(1);
    const problems = readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8');
    expect(problems).toContain('conflict markers remain in src/grid.ts');
    expect(problems).toContain('resolution.md has no paragraph for src/grid.ts');
  });

  it('checks conflicted paths that start with a dash or hold spaces as plain file names', () => {
    const files = ['-dash.ts', 'src/naïve grid.ts'];
    const { sb, repos } = committedMerge(files);
    writeFileSync(join(sb.sync, 'resolution.md'), '`src/naïve grid.ts`: keeps both.\n');
    writeFileSync(join(repos.work, '-dash.ts'), '<<<<<<< ours\nx\n>>>>>>> theirs\n');
    git(sb, repos.work, 'commit', '-q', '-am', 'bad');
    const r = run(sb, render(bashOf('final-verify'), sb.artifacts), { cwd: repos.work });
    expect(r.status).toBe(1);
    const problems = readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8');
    expect(problems).toBe(
      '- conflict markers remain in -dash.ts\n- resolution.md has no paragraph for -dash.ts\n'
    );
  });

  it('fails while the merge is still uncommitted', () => {
    const sb = makeSandbox();
    const repos = makeForkRepos(sb);
    git(sb, repos.work, 'fetch', '-q', repos.upstream, 'main');
    spawnSync(REAL_GIT, ['merge', '--no-ff', '--no-commit', repos.upstreamSha], {
      cwd: repos.work,
      env: sb.env,
    });
    git(sb, repos.work, 'fetch', '-q', repos.origin, '+refs/heads/main:refs/remotes/origin/main');
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({
        upstream_sha: repos.upstreamSha,
        fork_ref: 'main',
        branch: 'main',
        files: ['src/grid.ts'],
      })
    );
    writeFileSync(
      join(sb.sync, 'checks.json'),
      JSON.stringify({ passed: true, failed: [], ran: [], full: true })
    );
    writeFileSync(
      join(sb.sync, 'decision.json'),
      JSON.stringify({ needs_human: false, passed: true })
    );
    writeFileSync(join(sb.sync, 'resolution.md'), '`src/grid.ts`\n');
    const r = run(sb, render(bashOf('final-verify'), sb.artifacts), { cwd: repos.work });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8')).toContain(
      'the merge is not committed'
    );
  });
});

// ---------------------------------------------------------------------------
// PR body and publish
// ---------------------------------------------------------------------------

describe('publish node (executable)', () => {
  const SYNC = {
    repo: FORK_REPO,
    issue: ISSUE,
    upstream_repo: 'getpaseo/paseo',
    upstream_sha: SHA_A,
    fork_ref: 'sync-test/20261108-1-base',
    fork_sha: SHA_B,
    merge_base: SHA_C,
    branch: `sync/upstream-${ISSUE}-abcdef01`,
    files: ['src/grid.ts', 'docs/pinned-grid.md'],
  };
  const RESOLUTION =
    '`src/grid.ts`: upstream renamed the layout hook; the fork keeps the pinned row on the new hook.\n\n' +
    '`docs/pinned-grid.md`: upstream reworded the intro; the fork section stays below it.\n';
  const CHECKS = {
    passed: true,
    failed: [],
    ran: [
      { name: 'install', status: 'pass' },
      { name: 'lint', status: 'pass' },
    ],
    full: true,
  };

  function seed(sb: Sandbox): void {
    writeFileSync(join(sb.sync, 'sync.json'), JSON.stringify(SYNC));
    writeFileSync(join(sb.sync, 'resolution.md'), RESOLUTION);
    writeFileSync(join(sb.sync, 'checks.json'), JSON.stringify(CHECKS));
  }

  it('builds a body with Closes, one paragraph per file, checks and the merge rule', () => {
    const sb = makeSandbox();
    seed(sb);
    const fn = region(bashOf('publish'), 'pr-body');
    const r = run(sb, `set -euo pipefail\n${fn}\nbuild_pr_body "$1" "$2" "$3"`, {
      args: [
        join(sb.sync, 'sync.json'),
        join(sb.sync, 'resolution.md'),
        join(sb.sync, 'checks.json'),
      ],
    });
    expect(r.status).toBe(0);
    const body = r.stdout;
    expect(body.startsWith(`Closes #${ISSUE}\n`)).toBe(true);
    expect(body).toContain(`https://github.com/getpaseo/paseo/compare/${SHA_C}...${SHA_A}`);
    const paragraphs = body
      .split('\n\n')
      .filter(p => SYNC.files.some(f => p.startsWith(`\`${f}\``)));
    expect(paragraphs).toHaveLength(SYNC.files.length);
    expect(body).toContain('## Local checks\n\n- `install`: pass\n- `lint`: pass\n');
    expect(body.trimEnd().endsWith('Merge with **Create a merge commit**, not squash.')).toBe(true);
  });

  it('pushes the branch and opens the PR against fork_ref without merging it', () => {
    const sb = makeSandbox();
    seed(sb);
    const r = run(sb, render(bashOf('publish'), sb.artifacts), {
      env: { FAKE_GIT_ALLOW_PUSH: '1' },
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      pr_url: `https://github.com/${FORK_REPO}/pull/77`,
      number: 77,
    });
    expect(readJson<unknown>(join(sb.sync, 'pr.json'))).toEqual(JSON.parse(r.stdout));
    const log = calls(sb);
    expect(log[0]).toBe(`git push --quiet -u origin HEAD:refs/heads/${SYNC.branch}`);
    const create = log.find(c => c.startsWith('gh pr create'));
    expect(create).toMatch(
      new RegExp(
        `^gh pr create --repo ${FORK_REPO} --base sync-test/20261108-1-base --head ${SYNC.branch} ` +
          '--title sync: merge upstream getpaseo/paseo \\d{4}-\\d{2}-\\d{2} --body-file '
      )
    );
    expect(log.some(c => c.includes('pr merge'))).toBe(false);
    expect(readFileSync(join(sb.sync, 'pr-body.md'), 'utf-8')).toContain(`Closes #${ISSUE}`);
  });

  it('fails without opening a PR when the push fails', () => {
    const sb = makeSandbox();
    seed(sb);
    const r = run(sb, render(bashOf('publish'), sb.artifacts));
    expect(r.status).toBe(1);
    expect(calls(sb).some(c => c.startsWith('gh pr create'))).toBe(false);
    expect(existsSync(join(sb.sync, 'pr.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CI wait and the fix-ci loop condition
// ---------------------------------------------------------------------------

describe('CI wait (executable)', () => {
  const WAIT_CI_SH = heredoc(bashOf('wait-ci'), 'WAIT_CI_SH');

  function setup(
    responses: Array<{ out: string; code: number }>,
    prHeadLag = 0
  ): {
    sb: Sandbox;
    work: string;
  } {
    const sb = makeSandbox();
    const work = join(sb.root, 'work');
    mkdirSync(work, { recursive: true });
    git(sb, work, 'init', '-q', '-b', 'main');
    writeFileSync(join(work, 'f'), 'x\n');
    git(sb, work, 'add', 'f');
    git(sb, work, 'commit', '-q', '-m', 'c');
    const head = git(sb, work, 'rev-parse', 'HEAD');
    responses.forEach((resp, i) => {
      writeFileSync(join(sb.root, 'checks', `${i + 1}.out`), resp.out);
      writeFileSync(join(sb.root, 'checks', `${i + 1}.code`), String(resp.code));
    });
    writeFileSync(join(sb.sync, 'sync.json'), JSON.stringify({ repo: FORK_REPO }));
    writeFileSync(join(sb.sync, 'pr.json'), JSON.stringify({ pr_url: 'u', number: 77 }));
    writeFileSync(join(sb.sync, 'wait-ci.sh'), WAIT_CI_SH);
    sb.env.FAKE_PR_HEAD = prHeadLag > 0 ? 'f'.repeat(40) : head;
    return { sb, work };
  }

  const checksJson = (...buckets: Array<[string, string]>): string =>
    JSON.stringify(
      buckets.map(([name, bucket]) => ({
        name,
        state: bucket.toUpperCase(),
        bucket,
        link: `https://x/${name}`,
      }))
    );

  function waitCi(sb: Sandbox, work: string, attempt = 0): Record<string, unknown> {
    const r = run(sb, `bash "${join(sb.sync, 'wait-ci.sh')}" ${attempt}`, { cwd: work });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(readJson<unknown>(join(sb.sync, 'ci.json'))).toEqual(out);
    return out;
  }

  it('concludes success when every check passes', () => {
    const { sb, work } = setup([{ out: checksJson(['build', 'pass'], ['lint', 'pass']), code: 0 }]);
    expect(waitCi(sb, work)).toEqual({
      conclusion: 'success',
      failed: [],
      checks_url: `https://github.com/${FORK_REPO}/pull/77/checks`,
      attempt: 0,
    });
    // A conclusion needs the same complete check set on two polls in a row.
    expect(calls(sb).filter(c => c.startsWith('gh pr checks'))).toHaveLength(2);
    expect(calls(sb).filter(c => c.startsWith('sleep'))).toEqual(['sleep 60']);
  });

  it('does not conclude before a second workflow adds its failing checks', () => {
    const { sb, work } = setup([
      { out: checksJson(['build', 'pass']), code: 0 },
      { out: checksJson(['build', 'pass'], ['e2e', 'fail']), code: 1 },
    ]);
    const ci = waitCi(sb, work);
    expect(ci.conclusion).toBe('failure');
    expect(ci.failed).toEqual(['e2e']);
    expect(calls(sb).filter(c => c.startsWith('gh pr checks'))).toHaveLength(3);
  });

  it('keeps waiting when a second workflow adds a pending check', () => {
    const { sb, work } = setup([
      { out: checksJson(['build', 'pass']), code: 0 },
      { out: checksJson(['build', 'pass'], ['e2e', 'pending']), code: 8 },
      { out: checksJson(['build', 'pass'], ['e2e', 'pass']), code: 0 },
    ]);
    expect(waitCi(sb, work).conclusion).toBe('success');
    expect(calls(sb).filter(c => c.startsWith('gh pr checks'))).toHaveLength(4);
    expect(calls(sb).filter(c => c.startsWith('sleep'))).toHaveLength(3);
  });

  it('concludes failure with the failed check names', () => {
    const { sb, work } = setup([
      { out: checksJson(['build', 'pass'], ['e2e', 'fail'], ['old', 'cancel']), code: 1 },
    ]);
    const ci = waitCi(sb, work, 1);
    expect(ci.conclusion).toBe('failure');
    expect(ci.failed).toEqual(['e2e', 'old']);
    expect(ci.attempt).toBe(1);
  });

  it('counts skipping checks as passing', () => {
    const { sb, work } = setup([
      { out: checksJson(['build', 'pass'], ['deploy', 'skipping']), code: 0 },
    ]);
    expect(waitCi(sb, work).conclusion).toBe('success');
  });

  it('waits while checks are pending, parsing stdout whatever gh exits with', () => {
    const { sb, work } = setup([
      { out: checksJson(['build', 'pending']), code: 8 },
      { out: checksJson(['build', 'pass']), code: 0 },
    ]);
    expect(waitCi(sb, work).conclusion).toBe('success');
    expect(calls(sb).filter(c => c.startsWith('sleep'))).toEqual(['sleep 60', 'sleep 60']);
  });

  it('concludes no_checks when no check appears within ten polls', () => {
    const { sb, work } = setup([{ out: "no checks reported on the 'sync' branch", code: 1 }]);
    const ci = waitCi(sb, work);
    expect(ci.conclusion).toBe('no_checks');
    expect(ci.failed).toEqual([]);
    expect(calls(sb).filter(c => c.startsWith('gh pr checks'))).toHaveLength(10);
    expect(calls(sb).filter(c => c.startsWith('sleep'))).toHaveLength(9);
  });

  it('ignores checks until the PR head is the pushed commit', () => {
    const { sb, work } = setup([{ out: checksJson(['build', 'fail']), code: 1 }], 1);
    const ci = waitCi(sb, work);
    expect(ci.conclusion).toBe('no_checks');
    expect(calls(sb).some(c => c.startsWith('gh pr checks'))).toBe(false);
  });

  it('the wait-ci node writes the script and records attempt 0; the loop body increments it', () => {
    const { sb, work } = setup([{ out: checksJson(['build', 'fail']), code: 1 }]);
    rmSync(join(sb.sync, 'wait-ci.sh'));
    const first = run(sb, render(bashOf('wait-ci'), sb.artifacts), { cwd: work });
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ conclusion: 'failure', attempt: 0 });
    const again = loopGroupOf('fix-ci').nodes[1] as { bash?: string };
    const second = run(sb, render(again.bash ?? '', sb.artifacts), { cwd: work });
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({ conclusion: 'failure', attempt: 1 });
  });

  it('fix-ci stops after a non-failure conclusion or after the second attempt', () => {
    const sb = makeSandbox();
    const untilBash = render(loopGroupOf('fix-ci').until_bash ?? '', sb.artifacts);
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ conclusion: 'success', attempt: 1 }, 0],
      [{ conclusion: 'failure', attempt: 1 }, 1],
      [{ conclusion: 'failure', attempt: 2 }, 0],
      [{ conclusion: 'no_checks', attempt: 1 }, 0],
      [{ conclusion: 'timeout', attempt: 1 }, 0],
    ];
    for (const [ci, status] of cases) {
      writeFileSync(join(sb.sync, 'ci.json'), JSON.stringify(ci));
      expect(run(sb, untilBash).status).toBe(status);
    }
  });
});

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

describe('finalize node (executable)', () => {
  const SYNC = {
    repo: FORK_REPO,
    issue: ISSUE,
    upstream_sha: SHA_A,
    files: ['src/grid.ts'],
  };
  const ISSUE_ID = {
    repo: FORK_REPO,
    issue: ISSUE,
    issue_url: 'https://github.com/kevinle128/paseo/issues/42',
    run_url: 'https://archon.example.test/runs/r',
  };

  function runFinalize(sb: Sandbox): Record<string, unknown> {
    const r = run(sb, render(bashOf('finalize'), sb.artifacts));
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout) as Record<string, unknown>;
  }

  function seedPr(sb: Sandbox, ci?: Record<string, unknown>): void {
    writeFileSync(join(sb.sync, 'issue.json'), JSON.stringify(ISSUE_ID));
    writeFileSync(join(sb.sync, 'sync.json'), JSON.stringify(SYNC));
    writeFileSync(
      join(sb.sync, 'pr.json'),
      JSON.stringify({ pr_url: `https://github.com/${FORK_REPO}/pull/77`, number: 77 })
    );
    if (ci) writeFileSync(join(sb.sync, 'ci.json'), JSON.stringify(ci));
  }

  it('reports pr_ready with the PR and CI result and posts nothing', () => {
    const sb = makeSandbox();
    seedPr(sb, { conclusion: 'success', failed: [], checks_url: 'https://c', attempt: 0 });
    expect(runFinalize(sb)).toEqual({
      outcome: 'pr_ready',
      pr_url: `https://github.com/${FORK_REPO}/pull/77`,
      ci: { conclusion: 'success', failed: [], checks_url: 'https://c' },
      issue: ISSUE,
      upstream_sha: SHA_A,
      files: ['src/grid.ts'],
      notified: true,
    });
    expect(calls(sb)).toEqual([]);
  });

  it('reports ci_failed and comments on the issue and the PR, never closing anything', () => {
    const sb = makeSandbox();
    seedPr(sb, { conclusion: 'failure', failed: ['e2e'], checks_url: 'https://c', attempt: 2 });
    const out = runFinalize(sb);
    expect(out.outcome).toBe('ci_failed');
    expect(out.ci).toEqual({ conclusion: 'failure', failed: ['e2e'], checks_url: 'https://c' });
    const log = calls(sb);
    expect(
      log.filter(c => c.startsWith(`gh issue comment ${ISSUE} --repo ${FORK_REPO}`))
    ).toHaveLength(1);
    expect(log.filter(c => c.startsWith(`gh pr comment 77 --repo ${FORK_REPO}`))).toHaveLength(1);
    expect(log.some(c => c.includes('close') || c.includes('merge'))).toBe(false);
    const bodies = readFileSync(`${sb.log}.bodies`, 'utf-8');
    expect(bodies).toContain('after 2 fix attempt(s)');
    expect(bodies).toContain('Failed checks: e2e');
  });

  it('reports ci_unknown when CI showed no checks', () => {
    const sb = makeSandbox();
    seedPr(sb, { conclusion: 'no_checks', failed: [], checks_url: 'https://c', attempt: 0 });
    expect(runFinalize(sb).outcome).toBe('ci_unknown');
    expect(calls(sb).filter(c => c.startsWith('gh issue comment'))).toHaveLength(1);
  });

  it('reports ci_unknown when the CI wait left no result', () => {
    const sb = makeSandbox();
    seedPr(sb);
    const out = runFinalize(sb);
    expect(out.outcome).toBe('ci_unknown');
    expect(out.ci).toEqual({
      conclusion: 'unknown',
      failed: [],
      checks_url: `https://github.com/${FORK_REPO}/pull/77/checks`,
    });
  });

  it('comments once with the refusal when only the issue identity exists', () => {
    const sb = makeSandbox();
    writeFileSync(join(sb.sync, 'issue.json'), JSON.stringify(ISSUE_ID));
    writeFileSync(join(sb.sync, 'refusal.txt'), 'fork_ref must be "main"\n');
    expect(runFinalize(sb)).toEqual({
      outcome: 'failed',
      issue: ISSUE,
      stage: 'prepare (sync.json)',
      reason: 'fork_ref must be "main"',
      notified: true,
    });
    const log = calls(sb);
    expect(log).toHaveLength(1);
    expect(log[0]).toStartWith(`gh issue comment ${ISSUE} --repo ${FORK_REPO} --body-file `);
    const body = readFileSync(`${sb.log}.bodies`, 'utf-8');
    expect(body).toContain('failed at prepare (sync.json)');
    expect(body).toContain('Run: https://archon.example.test/runs/r');
  });

  it('names the stage of a late failure and quotes the verify problems', () => {
    const sb = makeSandbox();
    writeFileSync(join(sb.sync, 'issue.json'), JSON.stringify(ISSUE_ID));
    writeFileSync(join(sb.sync, 'sync.json'), JSON.stringify(SYNC));
    writeFileSync(join(sb.sync, 'resolution.md'), 'x');
    writeFileSync(join(sb.sync, 'decision.json'), '{}');
    writeFileSync(join(sb.sync, 'verify-problems.txt'), '- local checks fail: lint\n');
    const out = runFinalize(sb);
    expect(out.stage).toBe('final-verify or publish (pr.json)');
    expect(out.reason).toBe('- local checks fail: lint');
  });

  it('calls nothing when the issue was never confirmed', () => {
    const sb = makeSandbox();
    expect(runFinalize(sb)).toEqual({ outcome: 'failed', issue: null });
    expect(calls(sb)).toEqual([]);
  });
});
