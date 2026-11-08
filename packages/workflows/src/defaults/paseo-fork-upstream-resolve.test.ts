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
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'bun:test';
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
import { createGitVisibleChangesCommit } from '@archon/git';
import { BUNDLED_COMMANDS, BUNDLED_WORKFLOWS } from './bundled-defaults';

const NAME = 'paseo-fork-upstream-resolve';
const COMMAND_NAMES = ['paseo-fork-resolve-upstream-merge', 'paseo-fork-fix-ci'] as const;
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
  "issue list") cat "$FAKE_ISSUE_LIST_JSON" ;;
  "issue view") cat "$FAKE_ISSUE_JSON" ;;
  "pr list") cat "$FAKE_PR_LIST_JSON" ;;
  "issue comment")
    for a in "$@"; do if [ "$prev" = --body-file ]; then cat "$a" >> "$FAKE_LOG.bodies"; fi; prev=$a; done
    echo "https://github.com/$FAKE_REPO/issues/1#issuecomment-1" ;;
  "pr comment")
    for a in "$@"; do if [ "$prev" = --body-file ]; then cat "$a" >> "$FAKE_LOG.bodies"; fi; prev=$a; done
    echo "https://github.com/$FAKE_REPO/pull/77#issuecomment-2" ;;
  "pr edit")
    for a in "$@"; do if [ "$prev" = --body-file ]; then cat "$a" >> "$FAKE_LOG.bodies"; fi; prev=$a; done
    echo "https://github.com/$FAKE_REPO/pull/77" ;;
  "pr create") echo "https://github.com/$FAKE_REPO/pull/77" ;;
  "pr view")
    case "$*" in
      *baseRefName*) cat "$FAKE_PR_VIEW_JSON" ;;
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
  writeFileSync(
    join(root, 'issue-list.json'),
    JSON.stringify([{ number: ISSUE, url: `https://github.com/${FORK_REPO}/issues/${ISSUE}` }])
  );
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
      FAKE_ISSUE_LIST_JSON: join(root, 'issue-list.json'),
      FAKE_PR_LIST_JSON: join(root, 'pr-list.json'),
      FAKE_PR_VIEW_JSON: join(root, 'pr-view.json'),
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

// Each test removes its own sandboxes, so no single hook carries the whole cleanup.
afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
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

/** Write the scripts `prepare` creates, so later nodes can be run on their own. */
function installSyncScripts(sb: Sandbox): void {
  const prepare = bashOf('prepare');
  writeFileSync(join(sb.sync, 'checks.sh'), heredoc(prepare, 'CHECKS_SH'));
  writeFileSync(join(sb.sync, 'clean-tree.sh'), heredoc(prepare, 'CLEAN_TREE_SH'));
  writeFileSync(join(sb.sync, 'merge-commit.sh'), heredoc(prepare, 'MERGE_COMMIT_SH'));
  writeFileSync(join(sb.sync, 'final-checks.sh'), heredoc(prepare, 'FINAL_CHECKS_SH'));
  writeFileSync(join(sb.sync, 'wait-ci.sh'), heredoc(prepare, 'WAIT_CI_SH'));
}

/** Fake node, npm and npx: every check passes unless its command matches `failing`. */
function installToolchain(sb: Sandbox, failing = '__none__'): void {
  const fake = (tool: string): string => `#!/bin/bash
if [ "$1" = -p ]; then echo 22; exit 0; fi
case "${tool} $*" in *"${failing}"*) echo "boom from ${tool}"; exit 1 ;; esac
exit 0
`;
  for (const tool of ['node', 'npm', 'npx']) writeExecutable(join(sb.bin, tool), fake(tool));
}

/** A committed repository whose origin/main is HEAD, as prepare leaves it. */
function cleanRepo(sb: Sandbox): string {
  const work = join(sb.root, 'work');
  mkdirSync(work, { recursive: true });
  git(sb, work, 'init', '-q', '-b', 'main');
  writeFileSync(join(work, 'f'), 'x\n');
  git(sb, work, 'add', 'f');
  git(sb, work, 'commit', '-q', '-m', 'c');
  git(sb, work, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return work;
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
      'prepare',
      'resolve',
      'check',
      'ask-human',
      'apply-guidance',
      'publish',
      'create-pr',
      'verify-pr',
      'fix-ci',
      'finalize',
    ]);
    const rules = Object.fromEntries(
      WORKFLOW.nodes.map(n => [n.id, n.trigger_rule ?? 'all_success'])
    );
    expect(rules).toEqual({
      prepare: 'all_success',
      resolve: 'all_success',
      check: 'none_failed_min_one_success',
      'ask-human': 'all_success',
      'apply-guidance': 'all_success',
      publish: 'none_failed_min_one_success',
      'create-pr': 'all_success',
      'verify-pr': 'all_success',
      'fix-ci': 'all_success',
      finalize: 'all_done',
    });
    const deps = Object.fromEntries(WORKFLOW.nodes.map(n => [n.id, n.depends_on ?? []]));
    expect(deps).toEqual({
      prepare: [],
      resolve: ['prepare'],
      check: ['resolve'],
      'ask-human': ['check'],
      'apply-guidance': ['ask-human'],
      publish: ['check', 'apply-guidance'],
      'create-pr': ['publish'],
      'verify-pr': ['create-pr'],
      'fix-ci': ['verify-pr'],
      finalize: ['verify-pr', 'fix-ci'],
    });
    expect(nodeById('ask-human').when).toBe("$check.output.needs_human == 'true'");
    expect(nodeById('fix-ci').when).toBe("$verify-pr.output.conclusion == 'failure'");
    expect(WORKFLOW.returns).toBe('finalize');
  });

  it('declares no workflow input, interactive flag, provider or model', () => {
    expect(WORKFLOW.inputs).toBeUndefined();
    expect(WORKFLOW.interactive).toBeUndefined();
    expect(WORKFLOW.provider).toBeUndefined();
    expect(WORKFLOW.model).toBeUndefined();
    expect(YAML_TEXT).not.toContain('INPUTS_');
  });

  it('pins the verified models on the AI nodes and leaves the provider to the install', () => {
    const aiNodes = [...WORKFLOW.nodes, ...loopGroupOf('fix-ci').nodes].filter(
      n => 'prompt' in n || 'command' in n
    ) as Array<DagNode & { provider?: string }>;
    expect(aiNodes.map(n => n.id)).toEqual([
      'resolve',
      'apply-guidance',
      'create-pr',
      'fix-ci-attempt',
    ]);
    const models = Object.fromEntries(
      aiNodes.map(n => [n.id, { model: n.model, effort: n.effort }])
    );
    // The resolver needs the stronger model; the other AI nodes do bounded work.
    expect(models).toEqual({
      resolve: { model: 'gpt-6.1-terra', effort: 'medium' },
      'apply-guidance': { model: 'gpt-6-luna', effort: undefined },
      'create-pr': { model: 'gpt-6-luna', effort: undefined },
      'fix-ci-attempt': { model: 'gpt-6-luna', effort: undefined },
    });
    for (const node of aiNodes) expect(node.provider).toBeUndefined();
  });

  it('uses an approval gate without on_reject, so a reject cancels the run', () => {
    const node = nodeById('ask-human') as DagNode & {
      approval?: { capture_response?: boolean; on_reject?: unknown };
    };
    expect(node.approval?.capture_response).toBe(true);
    expect(node.approval?.on_reject).toBeUndefined();
    expect(node.when).toBe("$check.output.needs_human == 'true'");
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
    expect(group.until_bash).toContain('.attempt >= 2');
  });

  it('gives every slow bash node an explicit timeout', () => {
    const timeouts = Object.fromEntries(
      ['prepare', 'check', 'publish', 'verify-pr', 'finalize'].map(id => [id, nodeById(id).timeout])
    );
    expect(timeouts).toEqual({
      prepare: 1_800_000,
      check: 2_700_000,
      publish: 2_700_000,
      'verify-pr': 6_300_000,
      finalize: 300_000,
    });
    expect(loopGroupOf('fix-ci').nodes[1]?.timeout).toBe(6_000_000);
  });

  it('is bundled with its two commands, and the removed fix-checks command is gone', () => {
    expect(BUNDLED_COMMANDS['paseo-fork-fix-checks']).toBeUndefined();
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

  it('never merges a pull request and never uses auto, squash, rebase or force-push', () => {
    for (const text of allText) {
      expect(text).not.toContain('gh pr merge');
      expect(text).not.toContain('--auto');
      expect(text).not.toContain('--squash');
      expect(text).not.toContain('--rebase');
      expect(text).not.toContain('push --force');
    }
  });

  it('makes the resolve command create exactly one merge commit, or abort cleanly', () => {
    const text = BUNDLED_COMMANDS['paseo-fork-resolve-upstream-merge'] ?? '';
    expect(text).toContain('git merge --no-ff --no-commit "$upstream_sha"');
    expect(text).toContain(
      'git commit -m "Merge $upstream_repo ${upstream_sha:0:9} into $fork_ref"'
    );
    expect(text).toContain('exactly one merge commit');
    expect(text).toContain('git merge --abort');
    expect(text).toContain('bash "$ARTIFACTS_DIR/sync/checks.sh"');
    expect(text).toContain('at most 3 rounds');
    expect(text).not.toContain('git commit --no-edit');
    expect(text).not.toContain('--no-verify');
    for (const name of COMMAND_NAMES) {
      expect(BUNDLED_COMMANDS[name]).toContain('git status --porcelain --untracked-files=all');
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

  it('opens the pull request with the unchanged bundled archon-create-pr after pushing the branch', () => {
    const node = nodeById('create-pr') as DagNode & { command?: string; prompt_suffix?: string };
    expect(node.command).toBe('archon-create-pr');
    const disk = readFileSync(
      join(REPO_ROOT, '.archon/commands/defaults/archon-create-pr.md'),
      'utf-8'
    );
    expect(BUNDLED_COMMANDS['archon-create-pr']).toBe(disk.replace(/\r\n/g, '\n'));
    expect(COMMAND_NAMES as readonly string[]).not.toContain('archon-create-pr');
    const suffix = node.prompt_suffix ?? '';
    expect(suffix).toContain('The base is `$BASE_BRANCH` (main).');
    expect(suffix).toContain('`sync: merge upstream getpaseo/paseo <yyyy-mm-dd>`');
    expect(suffix).toContain('`Closes #<issue>`');
    expect(suffix).toContain('$ARTIFACTS_DIR/sync/resolution.md');
    expect(suffix).toContain('`Merge with **Create a merge commit**, not squash.`');
    expect(suffix).toContain('Do not push, pull, rebase, force-push or amend');
    // The branch is on origin before the command runs, so its own push is a no-op.
    expect(bashOf('publish')).toContain('git push -u origin HEAD');
    expect(bashOf('verify-pr')).toContain('PR_BASE=main');
  });

  it('has no test mode', () => {
    expect(YAML_TEXT).not.toMatch(/sync-test|\[test\]|TEST - do not merge|test_run/);
  });

  it('waits for CI with gh pr checks inside the documented windows', () => {
    const script = heredoc(bashOf('prepare'), 'WAIT_CI_SH');
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
  const checkOut = (needsHuman: boolean): NodeOutput =>
    completed({ needs_human: needsHuman, question: '', issue_url: 'u', run_url: 'r' });
  const ciOut = (conclusion: string): NodeOutput =>
    completed({ pr_url: 'p', number: 77, conclusion, failed: [], checks_url: 'c', attempt: 0 });

  it('skips the gate and the guidance pass (not fails) when no human is needed', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: checkOut(false),
      'verify-pr': ciOut('success'),
    });
    expect(d.check).toBe('run');
    expect(d['ask-human']).toBe('skip:when');
    expect(d['apply-guidance']).toBe('skip:trigger');
    expect(d.publish).toBe('run');
    expect(d['create-pr']).toBe('run');
    expect(d['verify-pr']).toBe('run');
    expect(d['fix-ci']).toBe('skip:when');
    expect(d.finalize).toBe('run');
  });

  it('runs the gate, the guidance pass and publish when a human is needed', () => {
    const d = simulate({
      resolve: resolveOut(false),
      check: checkOut(true),
      'verify-pr': ciOut('failure'),
    });
    expect(d['ask-human']).toBe('run');
    expect(d['apply-guidance']).toBe('run');
    expect(d.publish).toBe('run');
    expect(d['fix-ci']).toBe('run');
    expect(d.finalize).toBe('run');
  });

  it('still runs finalize, and only finalize, after prepare fails', () => {
    const d = simulate({
      prepare: { state: 'failed', output: '', error: 'refused' },
    });
    for (const id of [
      'resolve',
      'check',
      'ask-human',
      'apply-guidance',
      'publish',
      'create-pr',
      'verify-pr',
      'fix-ci',
    ]) {
      expect(d[id]).toBe('skip:trigger');
    }
    expect(d.finalize).toBe('run');
  });

  it('still runs finalize after publish fails', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: checkOut(false),
      publish: { state: 'failed', output: '', error: 'final checks fail' },
    });
    expect(d['create-pr']).toBe('skip:trigger');
    expect(d['verify-pr']).toBe('skip:trigger');
    expect(d['fix-ci']).toBe('skip:trigger');
    expect(d.finalize).toBe('run');
  });

  it('skips publish when check fails', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: { state: 'failed', output: '', error: 'guard' },
    });
    expect(d['ask-human']).toBe('skip:trigger');
    expect(d['apply-guidance']).toBe('skip:trigger');
    expect(d.publish).toBe('skip:trigger');
    expect(d.finalize).toBe('run');
  });
});

// ---------------------------------------------------------------------------
// Issue block parser and test guard
// ---------------------------------------------------------------------------

describe('fork-sync-conflict block validation (executable)', () => {
  let sb: Sandbox;
  const checks = region(bashOf('prepare'), 'sync-request-checks');

  beforeEach(() => {
    sb = makeSandbox();
  });

  function validate(
    body: string,
    repo = FORK_REPO
  ): { status: number | null; block: Record<string, unknown> | null; refusal: string } {
    const bodyFile = join(sb.root, 'body.md');
    writeFileSync(bodyFile, body);
    rmSync(join(sb.sync, 'refusal.txt'), { force: true });
    const result = run(sb, `set -euo pipefail\n${checks}\nvalidate_sync_block "$1" "$2"`, {
      args: [bodyFile, repo],
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

  it('accepts a valid production block', () => {
    const r = validate(`${blockLine()}\n\n## Upstream sync conflict\n`);
    expect(r.status).toBe(0);
    expect(r.refusal).toBe('');
    expect(r.block?.upstream_sha).toBe(SHA_A);
    expect(r.block?.fork_ref).toBe('main');
  });

  it('accepts CRLF line endings and file names with escaped comment markers', () => {
    const line = blockLine({ files: ['a-->b<c>.txt'] })
      .replace('a-->b<c>.txt', 'a--\\u003eb\\u003cc\\u003e.txt')
      .concat('\r\n');
    const r = validate(line);
    expect(r.status).toBe(0);
    expect(r.block?.files).toEqual(['a-->b<c>.txt']);
  });

  const refusals: Array<[string, string, string]> = [
    [
      'a body without the block',
      '## Upstream sync conflict\n',
      'line 1 of the issue body is not a fork-sync-conflict:v1 block',
    ],
    [
      'a block on line 2',
      `intro\n${blockLine()}\n`,
      'line 1 of the issue body is not a fork-sync-conflict:v1 block',
    ],
    ['a block that is not JSON', '<!-- fork-sync-conflict:v1 {nope -->\n', 'is not a JSON object'],
    ['a wrong schema', blockLine({ schema: 2 }), 'schema must be 1'],
    ['a wrong label', blockLine({ label: 'other' }), 'label must be "upstream-sync-conflict"'],
    [
      'another upstream repository',
      blockLine({ upstream_repo: 'evil/paseo' }),
      'upstream_repo must be "getpaseo/paseo"',
    ],
    [
      'a short upstream SHA',
      blockLine({ upstream_sha: 'aaaaaaaaa' }),
      'upstream_sha must be 40 lowercase hex characters',
    ],
    [
      'an uppercase fork SHA',
      blockLine({ fork_sha: 'B'.repeat(40) }),
      'fork_sha must be 40 lowercase hex characters',
    ],
    [
      'a missing merge base',
      blockLine({ merge_base: undefined }),
      'merge_base must be 40 lowercase hex characters',
    ],
    [
      'a fork_repo of another repository',
      blockLine({ fork_repo: 'someone/paseo' }),
      `fork_repo must be "${FORK_REPO}"`,
    ],
    [
      'a feature branch as fork_ref',
      blockLine({ fork_ref: 'feature/x' }),
      'fork_ref must be "main"',
    ],
    [
      'a throwaway test base as fork_ref',
      blockLine({ fork_ref: 'sync-test/20261108-1-base' }),
      'fork_ref must be "main"',
    ],
    ['a test block', blockLine({ test: true }), 'test blocks are not supported'],
    ['a non-boolean test flag', blockLine({ test: 'false' }), 'test must be the boolean false'],
    ['a missing test flag', blockLine({ test: undefined }), 'test must be the boolean false'],
    ['files that are not strings', blockLine({ files: [1] }), 'files must be an array of strings'],
  ];

  for (const [label, body, reason] of refusals) {
    it(`refuses ${label} and records the reason`, () => {
      const r = validate(body);
      expect(r.status).toBe(1);
      expect(r.refusal).toContain(reason);
    });
  }

  it('lists every reason when several fields are wrong', () => {
    const r = validate(blockLine({ schema: 3, fork_ref: 'feature/x' }));
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
  git(sb, sb.root, 'clone', '-q', '--shared', origin, upstream);
  writeAll(upstream, 'upstream');
  git(sb, upstream, 'commit', '-q', '-am', 'upstream change');
  const upstreamSha = git(sb, upstream, 'rev-parse', 'HEAD');
  writeAll(origin, 'fork');
  git(sb, origin, 'commit', '-q', '-am', 'fork change');
  const forkSha = git(sb, origin, 'rev-parse', 'HEAD');
  git(sb, sb.root, 'clone', '-q', '--shared', origin, work);
  git(sb, work, 'remote', 'set-url', 'origin', `https://github.com/${FORK_REPO}.git`);
  return { work, origin, upstream, upstreamSha, forkSha, mergeBase };
}

describe('prepare node (executable)', () => {
  function runPrepare(
    sb: Sandbox,
    repos: ForkRepos | null,
    options: {
      openIssues?: number[];
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
    if (options.openIssues) {
      writeFileSync(
        sb.env.FAKE_ISSUE_LIST_JSON as string,
        JSON.stringify(options.openIssues.map(number => ({ number, url: `u/${number}` })))
      );
    }
    const script = render(bashOf('prepare'), sb.artifacts);
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

  it('refuses a test block before fetching, so no run takes another path', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, {
      body: blockLine({ test: true }),
      labels: ['upstream-sync-conflict', 'sync-test'],
    });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'refusal.txt'), 'utf-8')).toContain(
      'test blocks are not supported'
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

  it('finds the one open conflict issue on GitHub, not in the run message', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, { body: blockLine({ fork_ref: 'feature/x' }) });
    expect(r.status).toBe(1);
    expect(calls(sb).slice(0, 3)).toEqual([
      `gh repo view https://github.com/${FORK_REPO}.git --json nameWithOwner -q .nameWithOwner`,
      `gh issue list --repo ${FORK_REPO} --label upstream-sync-conflict --state open --limit 100 --json number,url`,
      `gh issue view ${ISSUE} --repo ${FORK_REPO} --json number,state,title,labels,url,body`,
    ]);
  });

  it('stops without touching any issue when no conflict issue is open', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, { openIssues: [] });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No open upstream-sync-conflict issue');
    expect(calls(sb).some(c => c.startsWith('gh issue view'))).toBe(false);
    expect(existsSync(join(sb.sync, 'issue.json'))).toBe(false);
  });

  it('stops without touching any issue when several conflict issues are open', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, { openIssues: [41, ISSUE] });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      `Several open upstream-sync-conflict issues in ${FORK_REPO}: #41, #${ISSUE}. Exactly one is required.`
    );
    expect(calls(sb).some(c => c.startsWith('gh issue view'))).toBe(false);
    expect(existsSync(join(sb.sync, 'issue.json'))).toBe(false);
  });

  it('finds the conflicts with a trial merge and ends clean on a new per-run branch', () => {
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
      base_sha: repos.forkSha,
      merge_base: repos.mergeBase,
      branch: `sync/upstream-${ISSUE}-abcdef01`,
      files: ['src/grid.ts'],
      force_human: false,
    });
    expect(readJson<unknown>(join(sb.sync, 'sync.json'))).toEqual(sync);
    expect(git(sb, repos.work, 'symbolic-ref', '--short', 'HEAD')).toBe(
      `sync/upstream-${ISSUE}-abcdef01`
    );
    // The engine commits whatever a node leaves behind, so prepare must leave
    // no merge in progress and no change.
    expect(existsSync(join(repos.work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(sb, repos.work, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(git(sb, repos.work, 'rev-parse', 'HEAD')).toBe(repos.forkSha);
    expect(existsSync(join(sb.sync, 'checks.sh'))).toBe(true);
    expect(existsSync(join(sb.sync, 'clean-tree.sh'))).toBe(true);
    expect(readFileSync(join(sb.sync, 'issue.md'), 'utf-8')).toContain('## Upstream sync conflict');
  });

  it('starts from origin/main and only notes an older fork_sha in the issue', () => {
    const sb = makeSandbox();
    const repos = makeForkRepos(sb);
    const r = runPrepare(sb, repos, {
      body: blockLine({
        upstream_sha: repos.upstreamSha,
        fork_sha: repos.mergeBase,
        merge_base: repos.mergeBase,
        files: ['src/grid.ts'],
      }),
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(
      `note: origin/main is at ${repos.forkSha}; the issue recorded ${repos.mergeBase}`
    );
    expect((JSON.parse(r.stdout) as { base_sha: string }).base_sha).toBe(repos.forkSha);
    expect(git(sb, repos.work, 'rev-parse', 'HEAD')).toBe(repos.forkSha);
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
    expect(existsSync(join(repos.work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(sb, repos.work, 'status', '--porcelain', '--untracked-files=all')).toBe('');
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

  function setup(options: { failing?: string; nodeMajor?: string; messy?: string } = {}): {
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
    git(sb, work, 'add', '.');
    git(sb, work, 'commit', '-q', '-m', 'fixture');
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
case "${tool} $*" in *"${options.messy || '__none__'}"*)
  # A check that rewrites a tracked file, stages and deletes others, and leaves build output.
  echo changed > src/grid.ts
  echo staged > src/panel.tsx && git add src/panel.tsx
  rm -f src/grid.test.ts
  mkdir -p out && echo built > out/build.txt ;;
esac
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

  it('restores what the checks changed and keeps changes that were there before', () => {
    const { sb, work, script } = setup({ messy: 'run format:check', failing: 'run format:check' });
    writeFileSync(join(work, 'src/panel.test.tsx'), 'edited by the agent\n');
    writeFileSync(join(work, 'notes.txt'), 'untracked before the checks\n');
    const r = run(sb, `bash "${script}" format-check`, { cwd: work });
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { failed: string[] }).failed).toEqual(['format-check']);
    expect(readFileSync(join(work, 'src/grid.ts'), 'utf-8')).toBe('x\n');
    expect(readFileSync(join(work, 'src/panel.tsx'), 'utf-8')).toBe('x\n');
    expect(readFileSync(join(work, 'src/grid.test.ts'), 'utf-8')).toBe('x\n');
    expect(existsSync(join(work, 'out/build.txt'))).toBe(false);
    expect(readFileSync(join(work, 'src/panel.test.tsx'), 'utf-8')).toBe('edited by the agent\n');
    expect(readFileSync(join(work, 'notes.txt'), 'utf-8')).toBe('untracked before the checks\n');
    expect(git(sb, work, 'diff', '--name-only')).toBe('src/panel.test.tsx');
    expect(git(sb, work, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(sb, work, 'ls-files', '--others', '--exclude-standard')).toBe('notes.txt');
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

describe('check node (executable)', () => {
  function runCheck(
    resolve: { resolved: boolean; question: string },
    options: { forceHuman?: boolean; failing?: string; notes?: string; dirty?: boolean } = {}
  ): { sb: Sandbox; status: number | null; stdout: string; stderr: string } {
    const { sb, repos } = committedMerge();
    const sync = readJson<Record<string, unknown>>(join(sb.sync, 'sync.json'));
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({
        ...sync,
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
    writeFileSync(join(sb.sync, 'resolution.md'), options.notes ?? '`src/grid.ts`: keeps both.\n');
    installToolchain(sb, options.failing);
    if (options.dirty) {
      writeFileSync(join(repos.work, 'src/grid.ts'), 'left behind\n');
      git(sb, repos.work, 'commit', '-q', '-am', 'archon evidence: resolve end');
    }
    const script = render(bashOf('check'), sb.artifacts, {
      resolve: completed(resolve, ['resolved', 'question']),
    });
    return { sb, ...run(sb, script, { cwd: repos.work }) };
  }

  it('fails before asking anyone when the resolver left a change for the engine to commit', () => {
    const r = runCheck({ resolved: true, question: '' }, { dirty: true });
    expect(r.status).toBe(1);
    expect(readFileSync(join(r.sb.sync, 'guard-failure.txt'), 'utf-8')).toContain(
      'archon evidence: resolve end'
    );
    expect(calls(r.sb)).toEqual([]);
  });

  it('asks a human and comments once when the resolver cannot decide', () => {
    const r = runCheck({ resolved: false, question: "Keep the fork's `grid` or upstream's?" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      needs_human: true,
      question: "The resolver could not decide: Keep the fork's `grid` or upstream's?",
      issue_url: 'https://github.com/kevinle128/paseo/issues/42',
      run_url: 'https://archon.example.test/runs/r',
    });
    expect(calls(r.sb)).toHaveLength(1);
    expect(calls(r.sb)[0]).toStartWith(`gh issue comment ${ISSUE} --repo ${FORK_REPO}`);
    expect(readFileSync(`${r.sb.log}.bodies`, 'utf-8')).toContain(
      'The sync stays paused until a sync pull request merges.'
    );
  });

  it('asks nobody when the branch passes the final checks', () => {
    const r = runCheck({ resolved: true, question: '' });
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { needs_human: boolean }).needs_human).toBe(false);
    expect(calls(r.sb)).toEqual([]);
    expect(readJson<{ passed: boolean }>(join(r.sb.sync, 'decision.json')).passed).toBe(true);
    expect(readJson<{ full: boolean }>(join(r.sb.sync, 'checks.json')).full).toBe(true);
  });

  it('asks a human with the failed checks when the final checks fail', () => {
    const r = runCheck({ resolved: true, question: '' }, { failing: 'run lint' });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { needs_human: boolean; question: string };
    expect(out.needs_human).toBe(true);
    expect(out.question).toContain('The branch does not pass the final checks:');
    expect(out.question).toContain('- local checks fail: lint');
    expect(calls(r.sb).filter(c => c.startsWith('gh issue comment'))).toHaveLength(1);
  });

  it('asks a human when the notes miss a conflicted file', () => {
    const r = runCheck({ resolved: true, question: '' }, { notes: 'nothing useful\n' });
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { question: string }).question).toContain(
      'resolution.md has no paragraph for src/grid.ts'
    );
  });

  it('asks a human when the issue forces a review', () => {
    const r = runCheck({ resolved: true, question: '' }, { forceHuman: true });
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { needs_human: boolean }).needs_human).toBe(true);
    expect(calls(r.sb).filter(c => c.startsWith('gh issue comment'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// final checks
// ---------------------------------------------------------------------------

/** A fork whose sync branch holds the resolved merge commit, as resolve leaves it. */
function committedMerge(
  files: string[] = ['src/grid.ts'],
  message?: string
): { sb: Sandbox; repos: ForkRepos } {
  // One repository holds both sides, which keeps this fixture to few processes.
  const sb = makeSandbox();
  const work = join(sb.root, 'work');
  mkdirSync(work, { recursive: true });
  const writeAll = (content: string): void => {
    for (const file of files) {
      mkdirSync(dirname(join(work, file)), { recursive: true });
      writeFileSync(join(work, file), `export const grid = "${content}";\n`);
    }
  };
  git(sb, work, 'init', '-q', '-b', 'main');
  writeAll('base');
  git(sb, work, 'add', '-A');
  git(sb, work, 'commit', '-q', '-m', 'base');
  const mergeBase = git(sb, work, 'rev-parse', 'HEAD');
  git(sb, work, 'switch', '-q', '-c', 'upstream');
  writeAll('upstream');
  git(sb, work, 'commit', '-q', '-am', 'upstream change');
  const upstreamSha = git(sb, work, 'rev-parse', 'HEAD');
  git(sb, work, 'switch', '-q', 'main');
  writeAll('fork');
  git(sb, work, 'commit', '-q', '-am', 'fork change');
  const forkSha = git(sb, work, 'rev-parse', 'HEAD');
  git(sb, work, 'update-ref', 'refs/remotes/origin/main', forkSha);
  git(sb, work, 'switch', '-q', '-c', `sync/upstream-${ISSUE}-abcdef01`);
  spawnSync(REAL_GIT, ['merge', '--no-ff', '--no-commit', upstreamSha], { cwd: work, env: sb.env });
  writeAll('fork+upstream');
  git(sb, work, 'add', '-A');
  const repos: ForkRepos = { work, origin: '', upstream: '', upstreamSha, forkSha, mergeBase };
  git(
    sb,
    repos.work,
    'commit',
    '-q',
    '-m',
    message ?? `Merge getpaseo/paseo ${repos.upstreamSha.slice(0, 9)} into main`
  );
  writeFileSync(
    join(sb.sync, 'sync.json'),
    JSON.stringify({
      upstream_repo: 'getpaseo/paseo',
      upstream_sha: repos.upstreamSha,
      fork_ref: 'main',
      base_sha: repos.forkSha,
      branch: `sync/upstream-${ISSUE}-abcdef01`,
      files,
    })
  );
  installSyncScripts(sb);
  installToolchain(sb);
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

describe('final checks script (executable)', () => {
  const finalChecks = (sb: Sandbox, cwd: string): { status: number | null; stdout: string } =>
    run(sb, `bash "${join(sb.sync, 'final-checks.sh')}" "the test"`, { cwd });

  it('passes for a committed merge with notes for every conflicted file', () => {
    const { sb, repos } = committedMerge();
    writeFileSync(join(sb.sync, 'resolution.md'), '`src/grid.ts`: keeps both.\n');
    const r = finalChecks(sb, repos.work);
    expect(r.status).toBe(0);
    expect(existsSync(join(sb.sync, 'verify-problems.txt'))).toBe(false);
    expect(
      readJson<{ passed: boolean; full: boolean }>(join(sb.sync, 'checks.json'))
    ).toMatchObject({
      passed: true,
      full: true,
    });
  });

  it('fails and records the problems when notes or markers are wrong', () => {
    const { sb, repos } = committedMerge();
    writeFileSync(join(sb.sync, 'resolution.md'), 'nothing about the file\n');
    writeFileSync(join(repos.work, 'src/grid.ts'), '<<<<<<< ours\nx\n>>>>>>> theirs\n');
    git(sb, repos.work, 'commit', '-q', '-am', 'bad');
    const r = finalChecks(sb, repos.work);
    expect(r.status).toBe(10);
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
    const r = finalChecks(sb, repos.work);
    expect(r.status).toBe(10);
    const problems = readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8');
    expect(problems).toBe(
      '- conflict markers remain in -dash.ts\n- resolution.md has no paragraph for -dash.ts\n'
    );
  });

  it('fails when the merge commit does not carry the agreed message', () => {
    const { sb, repos } = committedMerge(['src/grid.ts'], 'Merge whatever');
    writeFileSync(join(sb.sync, 'resolution.md'), '`src/grid.ts`: keeps both.\n');
    const r = finalChecks(sb, repos.work);
    expect(r.status).toBe(10);
    expect(readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8')).toContain(
      `the merge commit message is not "Merge getpaseo/paseo ${repos.upstreamSha.slice(0, 9)} into main"`
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
        base_sha: repos.forkSha,
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
    installSyncScripts(sb);
    const r = finalChecks(sb, repos.work);
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'guard-failure.txt'), 'utf-8')).toContain(
      'a merge is still in progress'
    );
  });
});

// ---------------------------------------------------------------------------
// push-branch and verify-pr
// ---------------------------------------------------------------------------

describe('publish node (executable)', () => {
  it('pushes the branch that check passed, before archon-create-pr runs', () => {
    const { sb, repos } = committedMerge();
    const r = run(sb, render(bashOf('publish'), sb.artifacts), {
      cwd: repos.work,
      env: { FAKE_GIT_ALLOW_PUSH: '1' },
    });
    expect(r.status).toBe(0);
    expect(calls(sb)).toEqual(['git push -u origin HEAD']);
    expect(JSON.parse(r.stdout)).toMatchObject({
      pushed: true,
      branch: `sync/upstream-${ISSUE}-abcdef01`,
    });
  });

  it('fails when the push fails', () => {
    const { sb, repos } = committedMerge();
    const r = run(sb, render(bashOf('publish'), sb.artifacts), { cwd: repos.work });
    expect(r.status).toBe(1);
  });

  it('reruns the final checks after a human was needed, and pushes nothing when they fail', () => {
    const { sb, repos } = committedMerge();
    writeFileSync(join(sb.sync, 'decision.json'), JSON.stringify({ needs_human: true }));
    writeFileSync(join(sb.sync, 'resolution.md'), 'nothing useful\n');
    const r = run(sb, render(bashOf('publish'), sb.artifacts), {
      cwd: repos.work,
      env: { FAKE_GIT_ALLOW_PUSH: '1' },
    });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8')).toContain(
      'resolution.md has no paragraph for src/grid.ts'
    );
    expect(calls(sb).some(c => c.startsWith('git push'))).toBe(false);
  });

  it('pushes after a human was needed when the final checks pass', () => {
    const { sb, repos } = committedMerge();
    writeFileSync(join(sb.sync, 'decision.json'), JSON.stringify({ needs_human: true }));
    writeFileSync(join(sb.sync, 'resolution.md'), '`src/grid.ts`: keeps both.\n');
    const r = run(sb, render(bashOf('publish'), sb.artifacts), {
      cwd: repos.work,
      env: { FAKE_GIT_ALLOW_PUSH: '1' },
    });
    expect(r.status).toBe(0);
    expect(calls(sb)).toEqual(['git push -u origin HEAD']);
  });
});

describe('verify-pr node (executable)', () => {
  const RESOLUTION =
    '`src/grid.ts`: upstream renamed the layout hook; the fork keeps the pinned row.\n\n' +
    '`src/naïve grid.ts`: upstream reworded a label; the fork keeps its order.\n';
  const GOOD_BODY =
    'Summary of the sync.\n\n' +
    RESOLUTION +
    `\nCloses #${ISSUE}\n\nMerge with **Create a merge commit**, not squash.\n`;

  function setup(view: Record<string, unknown>): { sb: Sandbox; work: string; head: string } {
    const { sb, repos } = committedMerge(['src/grid.ts', 'src/naïve grid.ts']);
    const head = git(sb, repos.work, 'rev-parse', 'HEAD');
    const sync = readJson<Record<string, unknown>>(join(sb.sync, 'sync.json'));
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({ ...sync, repo: FORK_REPO, issue: ISSUE })
    );
    writeFileSync(join(sb.sync, 'resolution.md'), RESOLUTION);
    writeFileSync(join(sb.artifacts, '.pr-number'), '77\n');
    // The CI wait that follows the contract check sees one passing check.
    sb.env.FAKE_PR_HEAD = head;
    writeFileSync(
      join(sb.root, 'checks', '1.out'),
      JSON.stringify([{ name: 'ci', state: 'SUCCESS', bucket: 'pass', link: 'l' }])
    );
    writeFileSync(join(sb.root, 'checks', '1.code'), '0');
    writeFileSync(
      sb.env.FAKE_PR_VIEW_JSON as string,
      JSON.stringify({
        number: 77,
        url: `https://github.com/${FORK_REPO}/pull/77`,
        baseRefName: 'main',
        headRefName: `sync/upstream-${ISSUE}-abcdef01`,
        headRefOid: head,
        title: 'sync: merge upstream getpaseo/paseo 2026-11-08',
        body: GOOD_BODY,
        autoMergeRequest: null,
        state: 'OPEN',
        ...view,
      })
    );
    return { sb, work: repos.work, head };
  }

  function verifyPr(sb: Sandbox, work: string): { status: number | null; stdout: string } {
    return run(sb, render(bashOf('verify-pr'), sb.artifacts), { cwd: work });
  }

  it('accepts a PR that meets the contract, edits nothing, then waits for its CI', () => {
    const { sb, work } = setup({});
    const r = verifyPr(sb, work);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      pr_url: `https://github.com/${FORK_REPO}/pull/77`,
      number: 77,
      conclusion: 'success',
      failed: [],
      checks_url: `https://github.com/${FORK_REPO}/pull/77/checks`,
      attempt: 0,
    });
    expect(readJson<unknown>(join(sb.sync, 'pr.json'))).toEqual({
      pr_url: `https://github.com/${FORK_REPO}/pull/77`,
      number: 77,
    });
    expect(readJson<{ conclusion: string }>(join(sb.sync, 'ci.json')).conclusion).toBe('success');
    expect(calls(sb).some(c => c.startsWith('gh pr edit'))).toBe(false);
  });

  const mismatches: Array<[string, Record<string, unknown>, string]> = [
    ['a base other than main', { baseRefName: 'develop' }, 'the base is develop, not main'],
    [
      'another head branch',
      { headRefName: 'feature/x' },
      `the head branch is feature/x, not sync/upstream-${ISSUE}-abcdef01`,
    ],
    [
      'a head commit that is not the local HEAD',
      { headRefOid: 'e'.repeat(40) },
      'not the local HEAD',
    ],
    ['auto-merge', { autoMergeRequest: { mergeMethod: 'SQUASH' } }, 'auto-merge is enabled'],
    ['a closed PR', { state: 'CLOSED' }, 'the state is CLOSED, not OPEN'],
  ];
  for (const [label, view, reason] of mismatches) {
    it(`fails without editing on ${label}`, () => {
      const { sb, work } = setup(view);
      const r = verifyPr(sb, work);
      expect(r.status).toBe(1);
      expect(readFileSync(join(sb.sync, 'pr-problems.txt'), 'utf-8')).toContain(reason);
      expect(calls(sb).some(c => c.startsWith('gh pr edit'))).toBe(false);
      expect(calls(sb).some(c => c.startsWith('gh pr checks'))).toBe(false);
      expect(existsSync(join(sb.sync, 'pr.json'))).toBe(false);
    });
  }

  it('fails when the branch does not hold the expected merge commit', () => {
    const { sb, work } = setup({});
    const sync = readJson<Record<string, unknown>>(join(sb.sync, 'sync.json'));
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({ ...sync, upstream_sha: 'd'.repeat(40) })
    );
    const r = verifyPr(sb, work);
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'pr-problems.txt'), 'utf-8')).toContain(
      `the second parent of the merge commit`
    );
  });

  it('fails when archon-create-pr confirmed no PR', () => {
    const { sb, work } = setup({});
    rmSync(join(sb.artifacts, '.pr-number'));
    const r = verifyPr(sb, work);
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'pr-problems.txt'), 'utf-8')).toContain('no .pr-number');
  });

  it('adds a missing title and body elements with one gh pr edit and keeps the rest', () => {
    const { sb, work } = setup({
      title: 'Merge upstream changes',
      body: 'Summary of the sync.\n\n`src/grid.ts`: different words.\n',
    });
    const r = verifyPr(sb, work);
    expect(r.status).toBe(0);
    const edits = calls(sb).filter(c => c.startsWith('gh pr edit'));
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatch(
      new RegExp(
        `^gh pr edit 77 --repo ${FORK_REPO} --title sync: merge upstream getpaseo/paseo \\d{4}-\\d{2}-\\d{2} --body-file `
      )
    );
    const body = readFileSync(`${sb.log}.bodies`, 'utf-8');
    expect(body.startsWith('Summary of the sync.\n\n`src/grid.ts`: different words.\n\n')).toBe(
      true
    );
    expect(body).toContain(`\nCloses #${ISSUE}\n`);
    expect(body).toContain(`## Resolution\n\n${RESOLUTION}`);
    expect(body.trimEnd().endsWith('Merge with **Create a merge commit**, not squash.')).toBe(true);
  });

  it('edits only the body when only the merge line is missing', () => {
    const { sb, work } = setup({
      body: GOOD_BODY.replace('Merge with **Create a merge commit**, not squash.\n', ''),
    });
    const r = verifyPr(sb, work);
    expect(r.status).toBe(0);
    const edits = calls(sb).filter(c => c.startsWith('gh pr edit'));
    expect(edits).toHaveLength(1);
    expect(edits[0]).not.toContain('--title');
    expect(readFileSync(`${sb.log}.bodies`, 'utf-8')).not.toContain('## Resolution');
  });
});

// ---------------------------------------------------------------------------
// CI wait and the fix-ci loop condition
// ---------------------------------------------------------------------------

describe('CI wait (executable)', () => {
  const WAIT_CI_SH = heredoc(bashOf('prepare'), 'WAIT_CI_SH');

  function setup(
    responses: Array<{ out: string; code: number }>,
    prHeadLag = 0
  ): {
    sb: Sandbox;
    work: string;
  } {
    const sb = makeSandbox();
    const work = cleanRepo(sb);
    const head = git(sb, work, 'rev-parse', 'HEAD');
    installSyncScripts(sb);
    responses.forEach((resp, i) => {
      writeFileSync(join(sb.root, 'checks', `${i + 1}.out`), resp.out);
      writeFileSync(join(sb.root, 'checks', `${i + 1}.code`), String(resp.code));
    });
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({ repo: FORK_REPO, fork_ref: 'main', base_sha: head })
    );
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

  it('the loop body waits again and records the next attempt', () => {
    const { sb, work } = setup([{ out: checksJson(['build', 'fail']), code: 1 }]);
    writeFileSync(join(sb.sync, 'ci.json'), JSON.stringify({ conclusion: 'failure', attempt: 0 }));
    const again = loopGroupOf('fix-ci').nodes[1] as { bash?: string };
    const r = run(sb, render(again.bash ?? '', sb.artifacts), { cwd: work });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ conclusion: 'failure', attempt: 1 });
  });

  it('the loop body fails before waiting when the fix left a change for the engine to commit', () => {
    const { sb, work } = setup([{ out: checksJson(['build', 'fail']), code: 1 }]);
    writeFileSync(join(sb.sync, 'ci.json'), JSON.stringify({ conclusion: 'failure', attempt: 0 }));
    writeFileSync(join(work, 'f'), 'uncommitted fix\n');
    const again = loopGroupOf('fix-ci').nodes[1] as { bash?: string };
    const r = run(sb, render(again.bash ?? '', sb.artifacts), { cwd: work });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'guard-failure.txt'), 'utf-8')).toContain(' M f');
    expect(calls(sb).some(c => c.startsWith('gh pr checks'))).toBe(false);
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
// Clean worktree at every node boundary
// ---------------------------------------------------------------------------

describe('clean-tree guard (executable)', () => {
  function setup(): { sb: Sandbox; work: string; guard: string } {
    const sb = makeSandbox();
    const work = cleanRepo(sb);
    installSyncScripts(sb);
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({ fork_ref: 'main', base_sha: git(sb, work, 'rev-parse', 'HEAD') })
    );
    return { sb, work, guard: join(sb.sync, 'clean-tree.sh') };
  }

  it('passes on a clean tree with normal commits, and ignores ignored files', () => {
    const { sb, work, guard } = setup();
    writeFileSync(join(work, '.gitignore'), 'node_modules/\n');
    git(sb, work, 'add', '.gitignore');
    git(sb, work, 'commit', '-q', '-m', 'fix(sync): lint after upstream merge');
    mkdirSync(join(work, 'node_modules'), { recursive: true });
    writeFileSync(join(work, 'node_modules/x.js'), 'x\n');
    const r = run(sb, `bash "${guard}" "the end of verify"`, { cwd: work });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('fails on a tracked change and names the stage', () => {
    const { sb, work, guard } = setup();
    writeFileSync(join(work, 'f'), 'changed\n');
    const r = run(sb, `bash "${guard}" "the end of verify"`, { cwd: work });
    expect(r.status).toBe(1);
    const failure = readFileSync(join(sb.sync, 'guard-failure.txt'), 'utf-8');
    expect(failure).toContain('the end of verify');
    expect(failure).toContain(' M f');
    expect(r.stderr).toContain('the worktree has changes the engine would commit');
  });

  it('fails on an untracked file, because the engine snapshot also commits those', () => {
    const { sb, work, guard } = setup();
    writeFileSync(join(work, 'scratch.txt'), 'x\n');
    expect(run(sb, `bash "${guard}" s`, { cwd: work }).status).toBe(1);
  });

  it('fails while a merge is in progress even when nothing is left to stage', () => {
    const { sb, work, guard } = setup();
    git(sb, work, 'update-ref', 'MERGE_HEAD', 'HEAD');
    const r = run(sb, `bash "${guard}" s`, { cwd: work });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'guard-failure.txt'), 'utf-8')).toContain(
      'a merge is still in progress'
    );
  });

  it('fails when an earlier node left changes that the engine committed', () => {
    const { sb, work, guard } = setup();
    writeFileSync(join(work, 'f'), 'changed\n');
    git(sb, work, 'commit', '-q', '-am', 'archon checkpoint: paseo-fork-upstream-resolve/fix');
    const r = run(sb, `bash "${guard}" "the start of decide"`, { cwd: work });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'guard-failure.txt'), 'utf-8')).toContain(
      'archon checkpoint: paseo-fork-upstream-resolve/fix'
    );
  });
});

describe('node boundaries across prepare, resolve, check and publish', () => {
  // The engine's git calls read process.env; keep them on the sandbox git config.
  const saved = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  };
  beforeAll(() => {
    process.env.GIT_CONFIG_NOSYSTEM = '1';
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // This test runs four real node bodies end to end over three local repositories,
  // which is several hundred short git, jq and bash processes. Its cost grows with
  // machine load (2 to 5 s measured at load 20), so it gets its own budget. It does
  // no network or database I/O: the fake git blocks every remote command.
  it('leaves the engine nothing to snapshot, so the branch has one merge commit and no engine commits', async () => {
    const sb = makeSandbox();
    const repos = makeForkRepos(sb, ['src/grid.ts', 'src/naïve grid.ts']);
    git(sb, repos.work, 'config', 'user.name', 'Engine');
    git(sb, repos.work, 'config', 'user.email', 'engine@example.test');
    // The engine's own snapshot, run at the start and end of every node.
    const snapshots: boolean[] = [];
    process.env.GIT_CONFIG_GLOBAL = sb.env.GIT_CONFIG_GLOBAL;
    const boundary = async (label: string): Promise<void> => {
      const result = await createGitVisibleChangesCommit(repos.work, `archon evidence: ${label}`);
      snapshots.push(result.createdCommit);
    };

    // Control: the snapshot does commit a change in this repository.
    writeFileSync(join(repos.work, 'probe.txt'), 'x\n');
    const probe = await createGitVisibleChangesCommit(repos.work, 'probe');
    expect(probe.createdCommit).toBe(true);
    git(sb, repos.work, 'reset', '-q', '--hard', 'HEAD~1');

    // prepare
    writeFileSync(
      sb.env.FAKE_ISSUE_JSON as string,
      issueJson(
        `${blockLine({
          upstream_sha: repos.upstreamSha,
          fork_sha: repos.forkSha,
          merge_base: repos.mergeBase,
          files: ['src/grid.ts', 'src/naïve grid.ts'],
        })}\n`,
        ['upstream-sync-conflict']
      )
    );
    writeFileSync(sb.env.FAKE_PR_LIST_JSON as string, '[]');
    const env = { FAKE_UPSTREAM_DIR: repos.upstream, FAKE_ORIGIN_DIR: repos.origin };
    await boundary('prepare start');
    const prepare = run(sb, render(bashOf('prepare'), sb.artifacts), { cwd: repos.work, env });
    expect(prepare.status).toBe(0);
    await boundary('prepare end');

    // resolve, as the command instructs: start the merge, resolve, one merge commit.
    await boundary('resolve start');
    const resolve = run(
      sb,
      `set -euo pipefail
      sync="$ARTIFACTS_DIR/sync/sync.json"
      upstream_sha=$(jq -r .upstream_sha "$sync")
      upstream_repo=$(jq -r .upstream_repo "$sync")
      fork_ref=$(jq -r .fork_ref "$sync")
      git merge --no-ff --no-commit "$upstream_sha" >/dev/null 2>&1 || true
      jq -j '.files[] | . + "\\u0000"' "$sync" | while IFS= read -r -d '' f; do
        echo 'export const grid = "fork+upstream";' > "$f"
        git add -- "$f"
        printf '\x60%s\x60: keeps both.\n\n' "$f" >> "$ARTIFACTS_DIR/sync/resolution.md"
      done
      git commit -q -m "Merge $upstream_repo \${upstream_sha:0:9} into $fork_ref"`,
      { cwd: repos.work }
    );
    expect(resolve.status).toBe(0);
    await boundary('resolve end');

    // check, with a check that dirties the tree; checks.sh must restore it.
    writeExecutable(
      join(sb.bin, 'npm'),
      `#!/bin/bash\nif [ "$2" = lint ]; then echo dirty > src/grid.ts; mkdir -p out; echo b > out/b.txt; fi\nexit 0\n`
    );
    writeExecutable(
      join(sb.bin, 'node'),
      `#!/bin/bash\nif [ "$1" = -p ]; then echo 22; fi\nexit 0\n`
    );
    writeExecutable(join(sb.bin, 'npx'), '#!/bin/bash\nexit 0\n');
    await boundary('check start');
    const check = run(
      sb,
      render(bashOf('check'), sb.artifacts, {
        resolve: completed({ resolved: true, question: '' }, ['resolved', 'question']),
      }),
      { cwd: repos.work }
    );
    expect(check.stderr).not.toContain('problems');
    expect(check.status).toBe(0);
    expect((JSON.parse(check.stdout) as { needs_human: boolean }).needs_human).toBe(false);
    await boundary('check end');

    // publish pushes the branch that check passed.
    await boundary('publish start');
    const publish = run(sb, render(bashOf('publish'), sb.artifacts), {
      cwd: repos.work,
      env: { FAKE_GIT_ALLOW_PUSH: '1' },
    });
    expect(publish.status).toBe(0);
    await boundary('publish end');

    expect(snapshots).toEqual(Array(8).fill(false));
    const subjects = git(sb, repos.work, 'log', '--format=%s', 'refs/remotes/origin/main..HEAD')
      .split('\n')
      .filter(Boolean);
    expect(subjects.filter(s => /^archon (evidence|checkpoint)/.test(s))).toEqual([]);
    const merges = git(
      sb,
      repos.work,
      'rev-list',
      '--merges',
      '--first-parent',
      'refs/remotes/origin/main..HEAD'
    )
      .split('\n')
      .filter(Boolean);
    expect(merges).toHaveLength(1);
    const parents = git(sb, repos.work, 'rev-list', '--parents', '-n', '1', merges[0] ?? '').split(
      ' '
    );
    expect(parents.slice(1)).toEqual([repos.forkSha, repos.upstreamSha]);
    expect(git(sb, repos.work, 'log', '-1', '--format=%s', merges[0] ?? '')).toBe(
      `Merge getpaseo/paseo ${repos.upstreamSha.slice(0, 9)} into main`
    );
  }, 30_000);
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
    expect(out.stage).toBe('publish, create-pr or verify-pr (pr.json)');
    expect(out.reason).toBe('- local checks fail: lint');
  });

  it('calls nothing when the issue was never confirmed', () => {
    const sb = makeSandbox();
    expect(runFinalize(sb)).toEqual({ outcome: 'failed', issue: null });
    expect(calls(sb)).toEqual([]);
  });
});
