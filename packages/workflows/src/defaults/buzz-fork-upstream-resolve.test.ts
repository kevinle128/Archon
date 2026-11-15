/**
 * Tests for the bundled `buzz-fork-upstream-resolve` workflow and its commands.
 *
 * The bash bodies are executed for real: each test renders a node through the same
 * substitution functions the executor uses (`substituteWorkflowVariables` with
 * `shellSafe`, then `substituteNodeOutputRefs` with bash quoting) and runs it with
 * fake `gh`, `git` network commands, `sleep`, and a fake `curl` (blocking 127.0.0.1
 * calls used by cleanup.sh sweep). No test reaches the network: the fake `git` blocks
 * every fetch or push it does not redirect to a local repository, and the fake `gh`
 * fails on any unexpected call.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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

const NAME = 'buzz-fork-upstream-resolve';
const COMMAND_NAMES = ['buzz-fork-resolve-upstream-merge', 'buzz-fork-fix-ci'] as const;
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const YAML_PATH = join(REPO_ROOT, '.archon/workflows/defaults', `${NAME}.yaml`);
const YAML_TEXT = readFileSync(YAML_PATH, 'utf-8');
const RUN_ID = 'abcdef0123456789abcdef0123456789';
const FORK_REPO = 'kevinle128/buzz';
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
  "pr merge")
    # $FAKE_MERGE_RESULT: ok (default) records a merge commit; any other value fails.
    if [ "\${FAKE_MERGE_RESULT:-ok}" = ok ]; then echo "${'d'.repeat(40)}" > "$FAKE_CHECKS_DIR/merged"; exit 0; fi
    echo "GraphQL: Head branch was modified" >&2; exit 1 ;;
  "pr view")
    case "$*" in
      *baseRefName*) cat "$FAKE_PR_VIEW_JSON" ;;
      *mergeCommit*)
        if [ -f "$FAKE_CHECKS_DIR/merged" ]; then
          printf '{"state":"MERGED","mergeCommit":{"oid":"%s"}}\n' "$(cat "$FAKE_CHECKS_DIR/merged")"
        else
          echo '{"state":"OPEN","mergeCommit":null}'
        fi ;;
      *headRefOid*)
        # One state per poll from $FAKE_CHECKS_DIR/states; the last line repeats; OPEN without a file.
        v=$(( $(cat "$FAKE_CHECKS_DIR/view-count" 2>/dev/null || echo 0) + 1 ))
        echo "$v" > "$FAKE_CHECKS_DIR/view-count"
        state=$(sed -n "\${v}p" "$FAKE_CHECKS_DIR/states" 2>/dev/null || true)
        [ -n "$state" ] || state=$(tail -n 1 "$FAKE_CHECKS_DIR/states" 2>/dev/null || true)
        printf '{"headRefOid":"%s","state":"%s"}\\n' "$FAKE_PR_HEAD" "\${state:-OPEN}" ;;
      *) echo 77 ;;
    esac ;;
  "pr checks")
    n=$(( $(cat "$FAKE_CHECKS_DIR/count" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$FAKE_CHECKS_DIR/count"
    while [ "$n" -gt 1 ] && [ ! -f "$FAKE_CHECKS_DIR/$n.out" ]; do n=$((n - 1)); done
    cat "$FAKE_CHECKS_DIR/$n.out"
    exit "$(cat "$FAKE_CHECKS_DIR/$n.code")" ;;
  "run rerun") echo "rerun successful" ;;
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
        https://github.com/block/buzz.git) a="$FAKE_UPSTREAM_DIR" ;;
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

const FAKE_CURL = `#!/bin/bash
printf '%s\\n' "curl $*" >> "$FAKE_LOG"
case "$*" in
  *127.0.0.1*) exit 0 ;;
  *) printf 'HTTP/1.1 000\n'; exit 0 ;;
esac
`;

const FAKE_SLEEP = `#!/bin/bash
printf '%s\\n' "sleep $*" >> "$FAKE_LOG"
`;

// Docker with a state file of "<id> <name> <label> <image>" lines, so tests can
// see which containers exist while a check runs and that they are gone after it.
const FAKE_DOCKER = `#!/bin/bash
printf '%s\\n' "docker $*" >> "$FAKE_LOG"
state="$FAKE_DOCKER_STATE"
touch "$state"
case "$1" in
  info) exit 0 ;;
  run)
    name="" label="" prev=""
    for a in "$@"; do
      case "$prev" in --name) name=$a ;; --label) label=$a ;; esac
      prev=$a
    done
    image=\${@: -1}
    printf '%s %s %s %s\\n' "id-$name" "$name" "$label" "$image" >> "$state"
    echo "id-$name" ;;
  port)
    case "$3" in
      5432/tcp) echo "127.0.0.1:55432" ;;
      6379/tcp) echo "127.0.0.1:56379" ;;
    esac ;;
  exec) exit 0 ;;
  ps)
    filter="" prev=""
    for a in "$@"; do
      if [ "$prev" = --filter ]; then filter=\${a#label=}; fi
      prev=$a
    done
    awk -v l="$filter" '$3 == l { print $1 }' "$state" ;;
  rm)
    shift
    if [ "$1" = -f ]; then shift; fi
    for id in "$@"; do
      awk -v i="$id" '$1 != i' "$state" > "$state.tmp" && mv "$state.tmp" "$state"
    done ;;
  *) echo "fake docker: unexpected call: $*" >&2; exit 99 ;;
esac
`;

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'buzz-fork-resolve-'));
  sandboxes.push(root);
  const bin = join(root, 'bin');
  const artifacts = join(root, 'artifacts');
  const sync = join(artifacts, 'sync');
  mkdirSync(bin, { recursive: true });
  mkdirSync(sync, { recursive: true });
  mkdirSync(join(root, 'checks'), { recursive: true });
  writeExecutable(join(bin, 'gh'), FAKE_GH);
  writeExecutable(join(bin, 'git'), FAKE_GIT);
  writeExecutable(join(bin, 'curl'), FAKE_CURL);
  writeExecutable(join(bin, 'sleep'), FAKE_SLEEP);
  writeExecutable(join(bin, 'docker'), FAKE_DOCKER);
  // Link to the real jq if available, otherwise the tests will fail with a clear error
  const realJq = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
  if (realJq) {
    writeExecutable(join(bin, 'jq'), `#!/bin/bash\nexec "${realJq}" "$@"\n`);
  }
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
      // prepare starts the detached cleanup watcher; in tests it stops at once.
      CLEANUP_WATCH_POLLS: '0',
      FAKE_LOG: log,
      FAKE_REPO: FORK_REPO,
      FAKE_ISSUE_JSON: join(root, 'issue.json'),
      FAKE_ISSUE_LIST_JSON: join(root, 'issue-list.json'),
      FAKE_PR_LIST_JSON: join(root, 'pr-list.json'),
      FAKE_PR_VIEW_JSON: join(root, 'pr-view.json'),
      FAKE_CHECKS_DIR: join(root, 'checks'),
      FAKE_DOCKER_STATE: join(root, 'docker-containers'),
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
  writeFileSync(join(sb.sync, 'cleanup.sh'), heredoc(prepare, 'CLEANUP_SH'));
  writeFileSync(join(sb.sync, 'record-checks.sh'), heredoc(prepare, 'RECORD_CHECKS_SH'));
}

/** Fake Hermit and tools: pass a version check, fail only on explicit names. */
function installToolchain(sb: Sandbox, failing = '__none__'): void {
  // bin/activate-hermit is sourced, so it must be a valid script.
  writeExecutable(join(sb.root, 'bin', 'activate-hermit'), `#!/bin/bash\nexit 0\n`);

  const fake = (tool: string): string => `#!/bin/bash
case "$1" in
  --version) printf '%s 1.0.0\\n' '${tool}'; exit 0 ;;
  -p|--print-paths) printf '%s\\n' '${tool}'; exit 0 ;;
esac
printf '%s %s\\n' '${tool}' "$*" >> "$FAKE_LOG"
case "${tool} $*" in *"${failing}"*) echo "boom from ${tool}"; exit 1 ;; esac
exit 0
`;
  for (const tool of ['cargo', 'just', 'node', 'pnpm', 'rustfmt', 'clippy-driver']) {
    writeExecutable(join(sb.bin, tool), fake(tool));
  }
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
    kind: 'conflict',
    test: false,
    upstream_repo: 'block/buzz',
    upstream_sha: SHA_A,
    fork_repo: FORK_REPO,
    fork_ref: 'main',
    fork_sha: SHA_B,
    merge_base: SHA_C,
    files: ['crates/core/src/grid.rs'],
    failed_checks: [],
    run_url: 'https://github.com/kevinle128/buzz/actions/runs/1',
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

describe('buzz-fork-upstream-resolve structure', () => {
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
    const rules = Object.fromEntries(
      WORKFLOW.nodes.map(n => [n.id, n.trigger_rule ?? 'all_success'])
    );
    expect(rules).toEqual({
      prepare: 'all_success',
      resolve: 'all_success',
      check: 'none_failed_min_one_success',
      'fix-checks': 'all_success',
      publish: 'none_failed_min_one_success',
      'create-pr': 'all_success',
      'create-test-pr': 'all_success',
      'verify-pr': 'none_failed_min_one_success',
      'wait-ci': 'all_success',
      'rerun-ci': 'all_success',
      'fix-ci': 'all_success',
      'merge-pr': 'none_failed_min_one_success',
      finalize: 'all_done',
    });
    const deps = Object.fromEntries(WORKFLOW.nodes.map(n => [n.id, n.depends_on ?? []]));
    expect(deps).toEqual({
      prepare: [],
      resolve: ['prepare'],
      check: ['resolve'],
      'fix-checks': ['check'],
      publish: ['check', 'fix-checks'],
      'create-pr': ['publish'],
      'create-test-pr': ['publish'],
      'verify-pr': ['create-pr', 'create-test-pr'],
      'wait-ci': ['verify-pr'],
      'rerun-ci': ['wait-ci'],
      'fix-ci': ['rerun-ci'],
      'merge-pr': ['wait-ci', 'rerun-ci', 'fix-ci'],
      finalize: ['wait-ci', 'rerun-ci', 'fix-ci', 'merge-pr'],
    });
    expect(nodeById('create-pr').when).toBe("$publish.output.test == 'false'");
    expect(nodeById('create-test-pr').when).toBe("$publish.output.test == 'true'");
    expect(nodeById('rerun-ci').when).toBe("$wait-ci.output.conclusion == 'failure'");
    expect(nodeById('fix-ci').when).toBe("$rerun-ci.output.fix == 'true'");
    expect(nodeById('fix-checks').when).toBe("$check.output.passed == 'false'");
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
    const aiNodes = [
      ...WORKFLOW.nodes,
      ...loopGroupOf('fix-checks').nodes,
      ...loopGroupOf('fix-ci').nodes,
    ].filter(n => 'prompt' in n || 'command' in n) as Array<DagNode & { provider?: string }>;
    expect(aiNodes.map(n => n.id)).toEqual([
      'resolve',
      'create-pr',
      'fix-checks-attempt',
      'fix-ci-attempt',
    ]);
    const models = Object.fromEntries(
      aiNodes.map(n => [n.id, { model: n.model, effort: n.effort }])
    );
    // The resolver needs the stronger model; the other AI nodes do bounded work.
    expect(models).toEqual({
      resolve: { model: 'gpt-6.1-terra', effort: 'medium' },
      'create-pr': { model: 'gpt-6-luna', effort: undefined },
      'fix-checks-attempt': { model: 'gpt-6.1-terra', effort: 'medium' },
      'fix-ci-attempt': { model: 'gpt-6-luna', effort: undefined },
    });
    for (const node of aiNodes) expect(node.provider).toBeUndefined();
  });

  it('never asks a human: no approval gate, no guidance pass, no force-review label', () => {
    for (const node of WORKFLOW.nodes) {
      expect('approval' in node).toBe(false);
    }
    expect(YAML_TEXT).not.toContain('sync-force-human-review');
    expect(YAML_TEXT).not.toContain('force_human');
    for (const name of COMMAND_NAMES) {
      expect(BUNDLED_COMMANDS[name]).not.toContain('Guidance pass');
    }
  });

  it('fixes failing final checks in a bounded loop group of two passes with the merge rules', () => {
    const group = loopGroupOf('fix-checks');
    expect(group.max_iterations).toBe(3);
    expect(group.nodes.map(n => n.id)).toEqual(['fix-checks-attempt', 'recheck']);
    expect(group.until_bash).toContain('.passed or .attempt >= 2');
    const attempt = group.nodes[0] as DagNode & { command?: string; prompt_suffix?: string };
    expect(attempt.command).toBe('buzz-fork-resolve-upstream-merge');
    expect(attempt.prompt_suffix).toContain('follow the "Fix pass"');
    const text = BUNDLED_COMMANDS['buzz-fork-resolve-upstream-merge'] ?? '';
    expect(text).toContain('## Fix pass');
    expect(text).toContain('Do not delete fork features to make the');
    expect(text).toContain('never take one whole side');
  });

  it('fixes CI in a bounded loop group that ends before max_iterations', () => {
    const group = loopGroupOf('fix-ci');
    expect(group.max_iterations).toBe(3);
    expect(group.nodes.map(n => n.id)).toEqual(['pr-open', 'fix-ci-attempt', 'wait-ci-again']);
    expect(group.until_bash).toContain('.attempt >= 2');
  });

  it('gives every slow bash node an explicit timeout', () => {
    const timeouts = Object.fromEntries(
      ['prepare', 'check', 'publish', 'verify-pr', 'wait-ci', 'finalize'].map(id => [
        id,
        nodeById(id).timeout,
      ])
    );
    expect(timeouts).toEqual({
      prepare: 1_800_000,
      check: 14_400_000,
      publish: 2_700_000,
      'verify-pr': 600_000,
      'wait-ci': 6_300_000,
      finalize: 600_000,
    });
    expect(loopGroupOf('fix-ci').nodes[2]?.timeout).toBe(6_000_000);
    // The final checks after a fix pass run every local check as well.
    expect(loopGroupOf('fix-checks').nodes[1]?.timeout).toBe(14_400_000);
  });

  it('lets the agent nodes stay silent for one long check plus a build lock wait', () => {
    const idle = (n: DagNode): number | undefined => (n as { idle_timeout?: number }).idle_timeout;
    expect(idle(nodeById('resolve'))).toBe(7_200_000);
    expect(idle(loopGroupOf('fix-checks').nodes[0] as DagNode)).toBe(7_200_000);
    expect(idle(loopGroupOf('fix-ci').nodes[1] as DagNode)).toBe(7_200_000);
  });

  it('is bundled with its two commands, and both are byte-identical to disk', () => {
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

describe('buzz-fork-upstream-resolve policy', () => {
  const allText = [YAML_TEXT, ...COMMAND_NAMES.map(n => BUNDLED_COMMANDS[n] ?? '')];

  it('merges only in merge-pr, with a merge commit, and never uses auto, squash, rebase or force-push', () => {
    // Calls only: the reason texts of merge-pr also name the command.
    const mergeLines = YAML_TEXT.split('\n').filter(l => /^\s*(if ! )?gh pr merge /.test(l));
    expect(mergeLines).toHaveLength(1);
    expect(mergeLines[0]).toContain('--merge --match-head-commit "$head"');
    expect(bashOf('merge-pr')).toContain('gh pr merge');
    for (const name of COMMAND_NAMES) expect(BUNDLED_COMMANDS[name]).not.toContain('gh pr merge');
    for (const text of allText) {
      expect(text).not.toContain('--auto');
      expect(text).not.toContain('--squash');
      expect(text).not.toContain('--rebase');
      expect(text).not.toContain('push --force');
    }
  });

  it('makes the resolve command create exactly one merge commit, or abort cleanly', () => {
    const text = BUNDLED_COMMANDS['buzz-fork-resolve-upstream-merge'] ?? '';
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

  it('runs Playwright only in the desktop-e2e check, on the smoke project, never writing snapshots', () => {
    const checksSh = heredoc(bashOf('prepare'), 'CHECKS_SH');
    // Both Playwright runs (the list and the test run) select the smoke project.
    const runs = checksSh.split('pnpm exec playwright test').slice(1);
    expect(runs).toHaveLength(2);
    for (const rest of runs)
      expect(rest.trimStart().replace(/^\\\n\s*/, '')).toMatch(/^--project=smoke /);
    expect(checksSh).toContain('--update-snapshots=none');
    // Nothing outside checks.sh starts Playwright, and the commands never tell the
    // agent to start it.
    const yamlRuns = YAML_TEXT.split('\n').filter(l => /playwright (test|install)/.test(l));
    expect(yamlRuns).toHaveLength(3);
    for (const line of yamlRuns) expect(checksSh).toContain(line.trim());
    for (const name of COMMAND_NAMES) {
      expect(BUNDLED_COMMANDS[name] ?? '').not.toMatch(/playwright (test|install)/);
    }
  });

  it('makes one branch per attempt from the issue number and the run id', () => {
    expect(bashOf('prepare')).toContain('branch="sync/upstream-$issue-${WORKFLOW_ID:0:8}"');
  });

  it('has test mode support with sync-test label and base branches', () => {
    expect(YAML_TEXT).toContain('sync-test');
    expect(YAML_TEXT).toMatch(/test:\s*true/);
    expect(YAML_TEXT).toContain('TEST - do not merge');
    expect(YAML_TEXT).toContain('[test]');
    expect(bashOf('prepare')).toContain('TEST_LABEL=sync-test');
    expect(bashOf('prepare')).toContain('TEST_BASE_PATTERN');
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
    expect(suffix).toContain('`sync: merge upstream block/buzz <yyyy-mm-dd>`');
    expect(suffix).toContain('`Closes #<issue>`');
    expect(suffix).toContain('$ARTIFACTS_DIR/sync/resolution.md');
    expect(suffix).toContain('`Merge with **Create a merge commit**, not squash.`');
    expect(bashOf('publish')).toContain('git push -u origin HEAD');
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

describe('buzz-fork-upstream-resolve skip semantics', () => {
  const resolveOut = (resolved: boolean): NodeOutput =>
    completed({ resolved, question: resolved ? '' : 'Which side?' }, ['resolved', 'question']);
  const checkOut: NodeOutput = completed({ passed: true }, ['passed']);
  const publishOut = (test: boolean): NodeOutput =>
    completed({ test, pr_url: 'p', number: 77 }, ['test']);
  const prOut: NodeOutput = completed({ pr_url: 'p', number: 77 });
  const ciOut = (conclusion: string): NodeOutput =>
    completed({ pr_url: 'p', number: 77, conclusion, failed: [], checks_url: 'c', attempt: 0 });
  const reruncOut = (fix: boolean): NodeOutput => completed({ rerun: true, fix }, ['fix']);

  it('goes from a passing check to publish, the PR, CI and the merge with no question', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: checkOut,
      publish: publishOut(false),
      'create-pr': prOut,
      'verify-pr': prOut,
      'wait-ci': ciOut('success'),
    });
    expect(d.check).toBe('run');
    expect(d.publish).toBe('run');
    expect(d['create-pr']).toBe('run');
    expect(d['create-test-pr']).toBe('skip:when');
    expect(d['verify-pr']).toBe('run');
    expect(d['wait-ci']).toBe('run');
    expect(d['rerun-ci']).toBe('skip:when');
    // fix-ci depends only on rerun-ci, so a skipped rerun-ci skips it too.
    expect(d['fix-ci']).toBe('skip:trigger');
    expect(d['merge-pr']).toBe('run');
    expect(d.finalize).toBe('run');
  });

  it('runs the fix-checks loop when the final checks fail, then publish decides', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: completed({ passed: false }, ['passed']),
      publish: publishOut(false),
      'create-pr': prOut,
      'verify-pr': prOut,
      'wait-ci': ciOut('success'),
    });
    expect(d['fix-checks']).toBe('run');
    expect(d.publish).toBe('run');
    expect(d.finalize).toBe('run');
  });

  it('runs merge-pr after the re-run and the fixes, so it decides from the last CI result', () => {
    for (const fix of [false, true]) {
      const d = simulate({
        resolve: resolveOut(true),
        check: checkOut,
        publish: publishOut(false),
        'create-pr': prOut,
        'verify-pr': prOut,
        'wait-ci': ciOut('failure'),
        'rerun-ci': reruncOut(fix),
      });
      expect(d['fix-ci']).toBe(fix ? 'run' : 'skip:when');
      expect(d['merge-pr']).toBe('run');
      expect(d.finalize).toBe('run');
    }
  });

  it('uses create-test-pr when publish output test is true', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: checkOut,
      publish: publishOut(true),
      'create-test-pr': prOut,
      'verify-pr': prOut,
      'wait-ci': ciOut('success'),
    });
    expect(d['create-pr']).toBe('skip:when');
    expect(d['create-test-pr']).toBe('run');
    expect(d['merge-pr']).toBe('run');
    expect(d.finalize).toBe('run');
  });

  it('pushes nothing and opens no PR when check fails (unresolved or failing checks)', () => {
    const d = simulate({
      resolve: resolveOut(false),
      check: { state: 'failed', output: '', error: 'The resolver could not resolve the merge' },
    });
    for (const id of [
      'publish',
      'create-pr',
      'create-test-pr',
      'verify-pr',
      'wait-ci',
      'rerun-ci',
      'fix-ci',
      'merge-pr',
    ]) {
      expect(d[id]).toBe('skip:trigger');
    }
    expect(d.finalize).toBe('run');
  });

  it('still runs finalize, and only finalize, after prepare fails', () => {
    const d = simulate({
      prepare: { state: 'failed', output: '', error: 'refused' },
    });
    for (const id of [
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
    ]) {
      expect(d[id]).toBe('skip:trigger');
    }
    expect(d.finalize).toBe('run');
  });

  it('still runs finalize, and merges nothing, after create-pr fails', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: checkOut,
      publish: publishOut(false),
      'create-pr': { state: 'failed', output: '', error: 'contract' },
    });
    expect(d['verify-pr']).toBe('skip:trigger');
    expect(d['wait-ci']).toBe('skip:trigger');
    expect(d['merge-pr']).toBe('skip:trigger');
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
    repo = FORK_REPO,
    labels: string[] = []
  ): { status: number | null; block: Record<string, unknown> | null; refusal: string } {
    const bodyFile = join(sb.root, 'body.md');
    writeFileSync(bodyFile, body);
    rmSync(join(sb.sync, 'refusal.txt'), { force: true });
    const labelsJson = JSON.stringify(labels);
    const result = run(sb, `set -euo pipefail\n${checks}\nvalidate_sync_block "$1" "$2" "$3"`, {
      args: [bodyFile, repo, labelsJson],
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
    const r = validate(`${blockLine()}\n\n## Upstream sync conflict\n`, FORK_REPO, [
      'upstream-sync-conflict',
    ]);
    expect(r.status).toBe(0);
    expect(r.refusal).toBe('');
    expect(r.block?.upstream_sha).toBe(SHA_A);
    expect(r.block?.fork_ref).toBe('main');
    expect(r.block?.test).toBe(false);
    expect(r.block?.kind).toBe('conflict');
  });

  it('accepts a valid test block with sync-test label', () => {
    const testBase = 'sync-test/20261108-1-base';
    const r = validate(
      `${blockLine({ test: true, fork_ref: testBase })}\n\n## Upstream sync conflict\n`,
      FORK_REPO,
      ['upstream-sync-conflict', 'sync-test']
    );
    expect(r.status).toBe(0);
    expect(r.refusal).toBe('');
    expect(r.block?.test).toBe(true);
    expect(r.block?.fork_ref).toBe(testBase);
  });

  it('accepts a checks_failed block with failed_checks', () => {
    const r = validate(
      `${blockLine({ kind: 'checks_failed', files: [], failed_checks: ['rust-fmt', 'rust-check'] })}\n`,
      FORK_REPO,
      ['upstream-sync-conflict']
    );
    expect(r.status).toBe(0);
    expect(r.refusal).toBe('');
    expect(r.block?.kind).toBe('checks_failed');
    expect(r.block?.failed_checks).toEqual(['rust-fmt', 'rust-check']);
  });

  it('accepts CRLF line endings and file names with escaped comment markers', () => {
    const line = blockLine({ files: ['a-->b<c>.rs'] })
      .replace('a-->b<c>.rs', 'a--\\u003eb\\u003cc\\u003e.rs')
      .concat('\r\n');
    const r = validate(line, FORK_REPO, ['upstream-sync-conflict']);
    expect(r.status).toBe(0);
    expect(r.block?.files).toEqual(['a-->b<c>.rs']);
  });

  const refusals: Array<[string, string, string[]]> = [
    ['a body without the block', '## Upstream sync conflict\n', ['upstream-sync-conflict']],
    ['a block on line 2', `intro\n${blockLine()}\n`, ['upstream-sync-conflict']],
    [
      'a block that is not JSON',
      '<!-- fork-sync-conflict:v1 {nope -->\n',
      ['upstream-sync-conflict'],
    ],
    ['a wrong schema', blockLine({ schema: 2 }), ['upstream-sync-conflict']],
    ['a wrong label', blockLine({ label: 'other' }), ['upstream-sync-conflict']],
    [
      'another upstream repository',
      blockLine({ upstream_repo: 'evil/buzz' }),
      ['upstream-sync-conflict'],
    ],
    ['a short upstream SHA', blockLine({ upstream_sha: 'aaaaaaaaa' }), ['upstream-sync-conflict']],
    ['an uppercase fork SHA', blockLine({ fork_sha: 'B'.repeat(40) }), ['upstream-sync-conflict']],
    ['a missing merge base', blockLine({ merge_base: undefined }), ['upstream-sync-conflict']],
    [
      'a fork_repo of another repository',
      blockLine({ fork_repo: 'someone/buzz' }),
      ['upstream-sync-conflict'],
    ],
    [
      'a feature branch as fork_ref for production',
      blockLine({ fork_ref: 'feature/x', test: false }),
      ['upstream-sync-conflict'],
    ],
    [
      'a throwaway test base as fork_ref without test flag',
      blockLine({ fork_ref: 'sync-test/20261108-1-base', test: false }),
      ['upstream-sync-conflict'],
    ],
    [
      'a test block without sync-test label',
      blockLine({ test: true, fork_ref: 'sync-test/20261108-1-base' }),
      ['upstream-sync-conflict'],
    ],
    [
      'a production block with sync-test label',
      blockLine({ test: false }),
      ['upstream-sync-conflict', 'sync-test'],
    ],
    ['a non-boolean test flag', blockLine({ test: 'false' }), ['upstream-sync-conflict']],
    ['a missing test flag', blockLine({ test: undefined }), ['upstream-sync-conflict']],
    ['an invalid kind', blockLine({ kind: 'other' }), ['upstream-sync-conflict']],
    [
      'conflict with no files',
      blockLine({ kind: 'conflict', files: [] }),
      ['upstream-sync-conflict'],
    ],
    [
      'checks_failed with files',
      blockLine({ kind: 'checks_failed', files: ['f.rs'] }),
      ['upstream-sync-conflict'],
    ],
    [
      'checks_failed with no failed_checks',
      blockLine({ kind: 'checks_failed', files: [], failed_checks: [] }),
      ['upstream-sync-conflict'],
    ],
    [
      'failed_checks that are not strings',
      blockLine({ kind: 'checks_failed', files: [], failed_checks: [1] }),
      ['upstream-sync-conflict'],
    ],
    ['files that are not strings', blockLine({ files: [1] }), ['upstream-sync-conflict']],
  ];

  for (const [label, body, labels] of refusals) {
    it(`refuses ${label} and records the reason`, () => {
      const r = validate(body, FORK_REPO, labels);
      expect(r.status).toBe(1);
      expect(r.refusal).toBeTruthy();
    });
  }

  it('lists every reason when several fields are wrong', () => {
    const r = validate(blockLine({ schema: 3, fork_ref: 'feature/x' }), FORK_REPO, [
      'upstream-sync-conflict',
    ]);
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
function makeForkRepos(sb: Sandbox, files: string[] = ['crates/core/src/grid.rs']): ForkRepos {
  const origin = join(sb.root, 'origin');
  const upstream = join(sb.root, 'upstream');
  const work = join(sb.root, 'work');
  const writeAll = (repo: string, content: string): void => {
    for (const file of files) {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), `pub const GRID = "${content}";\n`);
    }
  };
  mkdirSync(origin, { recursive: true });
  git(sb, origin, 'init', '-q', '-b', 'main');
  writeAll(origin, 'base');
  mkdirSync(join(origin, 'crates/core/src'), { recursive: true });
  writeFileSync(join(origin, 'crates/core/src/grid.test.rs'), 'test\n');
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
      kind?: string;
      test?: boolean;
      failed_checks?: string[];
    }
  ): { status: number | null; stdout: string; stderr: string } {
    const kind = options.kind ?? 'conflict';
    const failedChecks = options.failed_checks ?? [];
    const body =
      options.body ??
      `${blockLine(
        repos
          ? {
              upstream_sha: repos.upstreamSha,
              fork_sha: repos.forkSha,
              merge_base: repos.mergeBase,
              kind,
              files: kind === 'conflict' ? (options.files ?? ['crates/core/src/grid.rs']) : [],
              failed_checks: failedChecks,
              test: options.test ?? false,
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
  });

  it('records the refusal reason for an invalid block and fetches nothing', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, { body: blockLine({ fork_ref: 'feature/x', test: false }) });
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

  it('refuses a test block without the sync-test label before fetching', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, {
      body: blockLine({ test: true, fork_ref: 'sync-test/20261108-1-base' }),
      labels: ['upstream-sync-conflict'],
    });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'refusal.txt'), 'utf-8')).toContain('has no sync-test label');
    expect(calls(sb).some(c => c.startsWith('git fetch'))).toBe(false);
  });

  it('refuses a production block with the sync-test label before fetching', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, {
      body: blockLine({ test: false }),
      labels: ['upstream-sync-conflict', 'sync-test'],
    });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'refusal.txt'), 'utf-8')).toContain(
      'must carry a test block'
    );
    expect(calls(sb).some(c => c.startsWith('git fetch'))).toBe(false);
  });

  it('finds the one open conflict issue on GitHub, not in the run message', () => {
    const sb = makeSandbox();
    const r = runPrepare(sb, null, { body: blockLine({ fork_ref: 'feature/x', test: false }) });
    expect(r.status).toBe(1);
    expect(calls(sb).slice(0, 3)).toEqual([
      `gh repo view https://github.com/${FORK_REPO}.git --json nameWithOwner -q .nameWithOwner`,
      `gh issue list --repo ${FORK_REPO} --label upstream-sync-conflict --state open --limit 100 --json number,url`,
      `gh issue view ${ISSUE} --repo ${FORK_REPO} --json number,state,title,labels,url,body`,
    ]);
  });

  it('finds the conflicts with a trial merge and ends clean on a new per-run branch', () => {
    const sb = makeSandbox();
    const repos = makeForkRepos(sb);
    const r = runPrepare(sb, repos, { labels: ['upstream-sync-conflict'] });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const sync = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(sync).toEqual({
      repo: FORK_REPO,
      issue: ISSUE,
      issue_url: `https://github.com/${FORK_REPO}/issues/${ISSUE}`,
      upstream_repo: 'block/buzz',
      upstream_sha: repos.upstreamSha,
      fork_ref: 'main',
      base_sha: repos.forkSha,
      merge_base: repos.mergeBase,
      branch: `sync/upstream-${ISSUE}-abcdef01`,
      kind: 'conflict',
      files: ['crates/core/src/grid.rs'],
      failed_checks: [],
      test: false,
      runs_root: join(sb.artifacts, 'state', 'sync-runs'),
      run_dir: join(sb.artifacts, 'state', 'sync-runs', RUN_ID),
    });
    expect(git(sb, repos.work, 'symbolic-ref', '--short', 'HEAD')).toBe(
      `sync/upstream-${ISSUE}-abcdef01`
    );
    expect(existsSync(join(repos.work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(sb, repos.work, 'status', '--porcelain', '--untracked-files=all')).toBe('');
  });

  it('records checks_failed with failed_checks list when the merge is clean', () => {
    const sb = makeSandbox();
    // For checks_failed, create a repo where the merge is clean (no conflicts).
    // makeForkRepos creates conflicts, so we need a different setup.
    const origin = join(sb.root, 'origin');
    const upstream = join(sb.root, 'upstream');
    const work = join(sb.root, 'work');
    mkdirSync(origin, { recursive: true });
    git(sb, origin, 'init', '-q', '-b', 'main');
    writeFileSync(join(origin, 'f'), 'x\n');
    git(sb, origin, 'add', '.');
    git(sb, origin, 'commit', '-q', '-m', 'base');
    const mergeBase = git(sb, origin, 'rev-parse', 'HEAD');
    git(sb, sb.root, 'clone', '-q', '--shared', origin, upstream);
    writeFileSync(join(upstream, 'f'), 'upstream change\n');
    git(sb, upstream, 'commit', '-q', '-am', 'upstream');
    const upstreamSha = git(sb, upstream, 'rev-parse', 'HEAD');
    writeFileSync(join(origin, 'g'), 'fork add\n');
    git(sb, origin, 'add', '.');
    git(sb, origin, 'commit', '-q', '-m', 'fork change');
    const forkSha = git(sb, origin, 'rev-parse', 'HEAD');
    git(sb, sb.root, 'clone', '-q', '--shared', origin, work);
    git(sb, work, 'remote', 'set-url', 'origin', `https://github.com/${FORK_REPO}.git`);
    const env = { FAKE_UPSTREAM_DIR: upstream, FAKE_ORIGIN_DIR: origin };

    const body = `${blockLine({
      upstream_sha: upstreamSha,
      fork_sha: forkSha,
      merge_base: mergeBase,
      kind: 'checks_failed',
      files: [],
      failed_checks: ['rust-fmt', 'rust-check'],
    })}\n\n## Upstream sync conflict\n`;
    writeFileSync(sb.env.FAKE_ISSUE_JSON as string, issueJson(body, ['upstream-sync-conflict']));
    writeFileSync(sb.env.FAKE_PR_LIST_JSON as string, JSON.stringify([]));

    const script = render(bashOf('prepare'), sb.artifacts);
    const r = run(sb, script, { cwd: work, env });
    expect(r.status).toBe(0);
    const sync = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(sync.kind).toBe('checks_failed');
    expect(sync.failed_checks).toEqual(['rust-fmt', 'rust-check']);
    expect(sync.files).toEqual([]);
  });

  it('accepts a test block with sync-test base and label in validation', () => {
    const sb = makeSandbox();
    const testBase = 'sync-test/20261108-1-base';
    const checks = region(bashOf('prepare'), 'sync-request-checks');
    const bodyFile = join(sb.root, 'body.md');
    writeFileSync(
      bodyFile,
      `${blockLine({ test: true, fork_ref: testBase })}\n\n## Upstream sync conflict\n`
    );
    const labelsJson = JSON.stringify(['upstream-sync-conflict', 'sync-test']);
    const result = run(sb, `set -euo pipefail\n${checks}\nvalidate_sync_block "$1" "$2" "$3"`, {
      args: [bodyFile, FORK_REPO, labelsJson],
    });
    expect(result.status).toBe(0);
    const block = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(block.test).toBe(true);
    expect(block.fork_ref).toBe(testBase);
  });
});

// ---------------------------------------------------------------------------
// Structure tests for CLEANUP_SH and sweep
// ---------------------------------------------------------------------------

describe('cleanup.sh sweep (structure)', () => {
  it('CLEANUP_SH is byte-identical to paseo version', () => {
    const buzzPrepare = bashOf('prepare');
    const buzzCleanup = heredoc(buzzPrepare, 'CLEANUP_SH');

    // We do not modify the cleanup script between Paseo and Buzz, so they should be identical.
    // Read the Paseo workflow YAML to get its CLEANUP_SH.
    const paseoYaml = readFileSync(
      join(REPO_ROOT, '.archon/workflows/defaults/paseo-fork-upstream-resolve.yaml'),
      'utf-8'
    );
    // Extract the prepare node from the YAML to get its bash body.
    const paseoWorkflow = parseWorkflow(paseoYaml, 'paseo-fork-upstream-resolve.yaml');
    if (paseoWorkflow.workflow === null) throw new Error('Failed to parse Paseo workflow');
    const paseoPrepare = (paseoWorkflow.workflow.nodes.find(n => n.id === 'prepare') as any)
      .bash as string;
    const paseoCleanup = heredoc(paseoPrepare, 'CLEANUP_SH');

    expect(buzzCleanup).toBe(paseoCleanup);
  });

  it('defines curl for local cleanup.sh sweep calls', () => {
    // The prepare node calls cleanup.sh sweep, which may use curl to call 127.0.0.1.
    // The test sandbox provides a fake curl that handles these calls.
    const sb = makeSandbox();
    expect(existsSync(join(sb.bin, 'curl'))).toBe(true);
    const result = run(sb, 'curl http://127.0.0.1:9999/test');
    // Fake curl exits 0 for 127.0.0.1 calls.
    expect(result.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Structure tests for finalize behavior
// ---------------------------------------------------------------------------

describe('finalize (structure)', () => {
  it('depends on wait-ci, rerun-ci, fix-ci and merge-pr, not just wait-ci', () => {
    const deps = nodeById('finalize').depends_on ?? [];
    expect(deps.sort()).toEqual(['fix-ci', 'merge-pr', 'rerun-ci', 'wait-ci'].sort());
  });

  it('runs with trigger_rule all_done to run even when fix-ci skips or fails', () => {
    expect(nodeById('finalize').trigger_rule).toBe('all_done');
  });
});

// ---------------------------------------------------------------------------
// checks.sh run for real with fake tools: rust-test runner and the hard limit
// ---------------------------------------------------------------------------

describe('checks.sh (executable)', () => {
  /**
   * A repository with the Hermit activation script and a sync.json, plus fake
   * cargo/just/node/pnpm. `cargo` follows FAKE_CARGO_MODE: `hang` sleeps in
   * `cargo test` (and writes its pid), `nextest` makes `cargo nextest` available.
   */
  function checksRepo(sb: Sandbox): string {
    const work = cleanRepo(sb);
    mkdirSync(join(work, 'bin'), { recursive: true });
    writeExecutable(join(work, 'bin', 'activate-hermit'), '#!/bin/bash\n');
    git(sb, work, 'add', 'bin/activate-hermit');
    git(sb, work, 'commit', '-q', '-m', 'hermit');
    installSyncScripts(sb);
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({
        base_sha: git(sb, work, 'rev-parse', 'HEAD'),
        upstream_sha: git(sb, work, 'rev-parse', 'HEAD'),
        files: [],
        run_dir: join(sb.root, 'run'),
      })
    );
    writeExecutable(
      join(sb.bin, 'cargo'),
      `#!/bin/bash
if [ "$1 $2" = "nextest --version" ]; then
  [ "\${FAKE_CARGO_MODE:-}" = nextest ] && { echo "cargo-nextest 0.9.0"; exit 0; }
  echo "error: no such command: nextest" >&2; exit 101
fi
printf 'cargo %s\\n' "$*" >> "$FAKE_LOG"
if [ "\${FAKE_CARGO_MODE:-}" = hang ] && [ "$1" = test ]; then
  echo $$ > "$FAKE_CARGO_PID"
  exec /bin/sleep 300
fi
exit 0
`
    );
    for (const tool of ['just', 'node', 'pnpm']) {
      writeExecutable(
        join(sb.bin, tool),
        `#!/bin/bash\nprintf '%s %s\\n' '${tool}' "$*" >> "$FAKE_LOG"\n` +
          `case "$*" in *clippy*) echo "clippy failed"; exit 1 ;; esac\nexit 0\n`
      );
    }
    return work;
  }

  function checks(sb: Sandbox, work: string, names: string[], env: NodeJS.ProcessEnv = {}) {
    return run(sb, `bash "${join(sb.sync, 'checks.sh')}" "$@"`, { cwd: work, args: names, env });
  }

  interface ChecksJson {
    passed: boolean;
    failed: string[];
    ran: { name: string; status: string }[];
  }

  it('stops a hung check at its limit, with every process, and reports it as timed out', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    const pidFile = join(sb.root, 'cargo.pid');
    const started = Date.now();
    const r = checks(sb, work, ['rust-test:buzz-relay', 'rust-fmt'], {
      FAKE_CARGO_MODE: 'hang',
      FAKE_CARGO_PID: pidFile,
      CHECK_TIMEOUT_SECONDS: '2',
    });
    const elapsed = Date.now() - started;
    expect(r.status).toBe(0);
    const result = readJson<ChecksJson>(join(sb.sync, 'checks.json'));
    expect(result.passed).toBe(false);
    expect(result.failed).toEqual(['rust-test:buzz-relay']);
    expect(result.ran).toEqual([
      { name: 'rust-test:buzz-relay', status: 'timeout' },
      { name: 'rust-fmt', status: 'pass' },
    ]);
    expect(r.stderr).toContain('check rust-test:buzz-relay: timeout');
    expect(readFileSync(join(sb.sync, 'checks.log'), 'utf-8')).toContain(
      'checks: rust-test:buzz-relay timed out after 2 s; its processes were stopped'
    );
    // The hung process (the fake cargo, now /bin/sleep) is gone, and the run did
    // not wait for its 300 s.
    const pid = Number(readFileSync(pidFile, 'utf-8').trim());
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive) process.kill(pid, 'SIGKILL');
    expect(alive).toBe(false);
    expect(elapsed).toBeLessThan(15_000);
  }, 30_000);

  it('runs crate tests on one thread without nextest, and with nextest when it exists', () => {
    for (const mode of ['', 'nextest']) {
      const sb = makeSandbox();
      const work = checksRepo(sb);
      const r = checks(sb, work, ['rust-test:buzz-relay'], { FAKE_CARGO_MODE: mode });
      expect(r.status).toBe(0);
      expect(readJson<ChecksJson>(join(sb.sync, 'checks.json')).passed).toBe(true);
      expect(calls(sb).filter(c => c.startsWith('cargo '))).toEqual([
        mode === 'nextest'
          ? 'cargo nextest run --locked -p buzz-relay --lib'
          : 'cargo test --locked -p buzz-relay --lib -- --test-threads=1',
      ]);
    }
  });

  it('still reports a passing and a failing check as pass and fail under the limit', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    const r = checks(sb, work, ['rust-fmt', 'rust-clippy']);
    expect(r.status).toBe(0);
    expect(readJson<ChecksJson>(join(sb.sync, 'checks.json')).ran).toEqual([
      { name: 'rust-fmt', status: 'pass' },
      { name: 'rust-clippy', status: 'fail' },
    ]);
  });

  /**
   * The repository files the PostgreSQL job reads: upstream's CI service images
   * and a fake scripts/postgres-test-run.sh that records its environment and the
   * containers that exist while it runs. FAKE_PG_MODE=hang makes it hang.
   */
  function postgresRepo(sb: Sandbox): { work: string; pgBin: string; envOut: string } {
    const work = checksRepo(sb);
    mkdirSync(join(work, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(work, '.github', 'workflows', '_ci-relay.yml'),
      'jobs:\n  postgres-tests:\n    services:\n      postgres:\n        image: postgres:17\n' +
        '      redis:\n        image: redis:8 # pinned\n'
    );
    mkdirSync(join(work, 'scripts'), { recursive: true });
    const envOut = join(sb.root, 'pg-env.txt');
    writeExecutable(
      join(work, 'scripts', 'postgres-test-run.sh'),
      `#!/bin/bash
env | grep -E '^(BUZZ_POSTGRES_ADMIN_URL|REDIS_URL|PG_BIN_DIR|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGSCHEMA_PLAN_[A-Z]+)=' | LC_ALL=C sort > "${envOut}"
cp "$FAKE_DOCKER_STATE" "${envOut}.containers"
command -v psql > "${envOut}.psql"
if [ "\${FAKE_PG_MODE:-}" = hang ]; then echo $$ > "$FAKE_CARGO_PID"; exec /bin/sleep 300; fi
echo "$*" > "${envOut}.args"
echo "\${NEXTEST_RETRIES:-}" > "${envOut}.retries"
exit "\${FAKE_PG_RC:-0}"
`
    );
    writeExecutable(
      join(work, 'scripts', 'postgres-test-packages.sh'),
      '#!/bin/bash\nprintf "buzz-db\\nbuzz-relay\\n"\n'
    );
    git(sb, work, 'add', '.github', 'scripts');
    git(sb, work, 'commit', '-q', '-m', 'ci');
    const pgBin = join(sb.root, 'pgbin');
    mkdirSync(pgBin, { recursive: true });
    for (const tool of ['psql', 'createdb', 'dropdb', 'pg_isready']) {
      writeExecutable(
        join(pgBin, tool),
        `#!/bin/bash\nprintf '%s %s\\n' '${tool}' "$*" >> "$FAKE_LOG"\nexit 0\n`
      );
    }
    return { work, pgBin, envOut };
  }

  it('runs the PostgreSQL job against throwaway labelled containers and removes them', () => {
    const sb = makeSandbox();
    const { work, pgBin, envOut } = postgresRepo(sb);
    const r = checks(sb, work, ['rust-test-postgres'], {
      FAKE_CARGO_MODE: 'nextest',
      PG_BIN_DIR: pgBin,
    });
    expect(r.status).toBe(0);
    expect(readJson<ChecksJson>(join(sb.sync, 'checks.json')).ran).toEqual([
      { name: 'rust-test-postgres', status: 'pass' },
    ]);
    // The job's environment, with the ports Docker published.
    expect(readFileSync(envOut, 'utf-8').trim().split('\n')).toEqual([
      'BUZZ_POSTGRES_ADMIN_URL=postgres://buzz:buzz_dev@127.0.0.1:55432/postgres',
      'PGHOST=127.0.0.1',
      'PGPASSWORD=buzz_dev',
      'PGPORT=55432',
      'PGSCHEMA_PLAN_HOST=127.0.0.1',
      'PGSCHEMA_PLAN_PASSWORD=buzz_dev',
      'PGSCHEMA_PLAN_PORT=55432',
      'PGSCHEMA_PLAN_USER=buzz',
      'PGUSER=buzz',
      `PG_BIN_DIR=${pgBin}`,
      'REDIS_URL=redis://127.0.0.1:56379',
    ]);
    // The packages the script finds, built with CI's cargo profile, one retry.
    expect(readFileSync(`${envOut}.args`, 'utf-8').trim()).toBe(
      '-p buzz-db -p buzz-relay --lib --tests --cargo-profile ci'
    );
    expect(readFileSync(`${envOut}.retries`, 'utf-8').trim()).toBe('1');
    // Tests that start psql by name find the same client.
    expect(readFileSync(`${envOut}.psql`, 'utf-8').trim()).toBe(join(pgBin, 'psql'));
    // Two containers of this run, on the images upstream CI uses, while the job ran.
    const during = readFileSync(`${envOut}.containers`, 'utf-8').trim().split('\n');
    expect(during).toHaveLength(2);
    for (const line of during) expect(line).toContain(' archon.sync-run=run ');
    expect(during.map(l => l.split(' ')[3]).sort()).toEqual(['postgres:17', 'redis:8']);
    expect(calls(sb).filter(c => c.startsWith('docker run'))).toEqual([
      expect.stringContaining('-p 127.0.0.1::5432 postgres:17'),
      expect.stringContaining('-p 127.0.0.1::6379 redis:8'),
    ]);
    // The disposable server is tuned like CI's, and nothing is left behind.
    expect(calls(sb).some(c => c.startsWith('psql') && c.includes('fsync = off'))).toBe(true);
    expect(readFileSync(join(sb.root, 'docker-containers'), 'utf-8')).toBe('');
  });

  it('removes the containers of a PostgreSQL job that hit its time limit', () => {
    const sb = makeSandbox();
    const { work, pgBin } = postgresRepo(sb);
    const pidFile = join(sb.root, 'cargo.pid');
    const r = checks(sb, work, ['rust-test-postgres'], {
      FAKE_CARGO_MODE: 'nextest',
      FAKE_PG_MODE: 'hang',
      FAKE_CARGO_PID: pidFile,
      PG_BIN_DIR: pgBin,
      CHECK_TIMEOUT_SECONDS: '2',
    });
    expect(r.status).toBe(0);
    expect(readJson<ChecksJson>(join(sb.sync, 'checks.json')).ran).toEqual([
      { name: 'rust-test-postgres', status: 'timeout' },
    ]);
    expect(readFileSync(join(sb.root, 'docker-containers'), 'utf-8')).toBe('');
    const pid = Number(readFileSync(pidFile, 'utf-8').trim());
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive) process.kill(pid, 'SIGKILL');
    expect(alive).toBe(false);
  }, 30_000);

  it('fails the PostgreSQL job without nextest, because its database wrapper needs nextest', () => {
    const sb = makeSandbox();
    const { work, pgBin, envOut } = postgresRepo(sb);
    checks(sb, work, ['rust-test-postgres'], { PG_BIN_DIR: pgBin });
    expect(readJson<ChecksJson>(join(sb.sync, 'checks.json')).ran).toEqual([
      { name: 'rust-test-postgres', status: 'fail' },
    ]);
    expect(existsSync(envOut)).toBe(false);
    expect(calls(sb).some(c => c.startsWith('docker run'))).toBe(false);
  });

  const HAS_LOCKF =
    spawnSync('bash', ['-c', 'command -v lockf'], { encoding: 'utf8' }).status === 0;

  it('holds the shared build lock while a check runs, and frees it afterwards', () => {
    if (!HAS_LOCKF) return; // lockf exists on macOS, where the mini runs the checks
    const sb = makeSandbox();
    const work = checksRepo(sb);
    const lock = join(sb.root, 'build.lock');
    // The fake just reports whether the lock is free while the check runs.
    writeExecutable(
      join(sb.bin, 'just'),
      `#!/bin/bash\nif lockf -s -t 0 "${lock}" true; then echo free >> "$FAKE_LOG"; else echo held >> "$FAKE_LOG"; fi\nexit 0\n`
    );
    checks(sb, work, ['rust-fmt'], { FORK_SYNC_BUILD_LOCK: lock });
    expect(calls(sb)).toContain('held');
    expect(spawnSync('lockf', ['-s', '-t', '0', lock, 'true']).status).toBe(0);
  });

  it('does not run a check while a release build holds the lock', () => {
    if (!HAS_LOCKF) return;
    const sb = makeSandbox();
    const work = checksRepo(sb);
    const lock = join(sb.root, 'build.lock');
    const holder = spawn('lockf', ['-k', lock, '/bin/sleep', '20'], { stdio: 'ignore' });
    try {
      spawnSync('/bin/sleep', ['0.5']);
      checks(sb, work, ['rust-fmt'], { FORK_SYNC_BUILD_LOCK: lock, BUILD_LOCK_WAIT_SECONDS: '1' });
      expect(readJson<ChecksJson>(join(sb.sync, 'checks.json')).ran).toEqual([
        { name: 'rust-fmt', status: 'fail' },
      ]);
      expect(calls(sb)).not.toContain('just fmt-check');
      expect(readFileSync(join(sb.sync, 'checks.log'), 'utf-8')).toContain('a release build runs');
    } finally {
      holder.kill('SIGKILL');
    }
  }, 30_000);

  it('runs the unit test job with the Justfile recipe', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    checks(sb, work, ['rust-test-unit'], { FAKE_CARGO_MODE: 'nextest' });
    expect(readJson<ChecksJson>(join(sb.sync, 'checks.json')).passed).toBe(true);
    expect(calls(sb)).toContain('just test-unit');
  });

  it('runs every Rust test job and the related desktop specs in a full run', () => {
    const sb = makeSandbox();
    const work = checksRepo(sb);
    const r = run(
      sb,
      `bash "${join(sb.sync, 'checks.sh')}" >/dev/null; cat "${join(sb.sync, 'check-names')}" | tr '\\0' ' '`,
      {
        cwd: work,
        env: { CHECK_TIMEOUT_SECONDS: '1' },
      }
    );
    expect(r.stdout.trim().split(' ')).toEqual([
      'rust-fmt',
      'migration-numbers',
      'rust-check',
      'rust-clippy',
      'rust-test-unit',
      'rust-test-postgres',
      'desktop-e2e',
    ]);
  }, 30_000);

  /** A desktop/ folder and a fake pnpm that answers Playwright's list and run. */
  function e2eRepo(
    sb: Sandbox,
    report: unknown,
    exitCode: number
  ): { work: string; mergeBase: string } {
    const work = checksRepo(sb);
    mkdirSync(join(work, 'desktop'), { recursive: true });
    const mergeBase = git(sb, work, 'rev-parse', 'HEAD');
    const syncPath = join(sb.sync, 'sync.json');
    writeFileSync(
      syncPath,
      JSON.stringify({ ...readJson<Record<string, unknown>>(syncPath), merge_base: mergeBase })
    );
    const list = {
      suites: [
        { title: 'smoke.spec.ts', file: 'smoke.spec.ts', specs: [] },
        {
          title: 'workflow-local-controls.spec.ts',
          file: 'workflow-local-controls.spec.ts',
          specs: [],
        },
      ],
    };
    writeFileSync(join(sb.root, 'pw-list.json'), JSON.stringify(list));
    writeFileSync(join(sb.root, 'pw-report.json'), JSON.stringify(report));
    writeExecutable(
      join(sb.bin, 'pnpm'),
      `#!/bin/bash
printf 'pnpm %s [CI=%s]\\n' "$*" "\${CI:-}" >> "$FAKE_LOG"
case "$*" in
  *"playwright test"*--list*) cat "${join(sb.root, 'pw-list.json')}" ;;
  *"playwright test"*) cp "${join(sb.root, 'pw-report.json')}" "$PLAYWRIGHT_JSON_OUTPUT_NAME"; exit ${exitCode} ;;
esac
exit 0
`
    );
    return { work, mergeBase };
  }

  function failedReport(message: string): unknown {
    return {
      suites: [
        {
          title: 'workflow-local-controls.spec.ts',
          file: 'workflow-local-controls.spec.ts',
          specs: [
            {
              title: 'template variable autocomplete',
              tests: [
                { status: 'unexpected', results: [{ status: 'failed', errors: [{ message }] }] },
              ],
            },
          ],
        },
      ],
    };
  }

  const DARWIN_DIFF =
    'Error: expect(page).toHaveScreenshot(expected) failed\n\n  22 pixels (ratio 0.01 of all image pixels) are different.\n\n' +
    '  Expected: /w/desktop/tests/e2e/workflow-local-controls.spec.ts-snapshots/autocomplete-smoke-darwin.png';

  it('runs the changed desktop smoke specs plus smoke.spec.ts, never writing snapshots', () => {
    const sb = makeSandbox();
    const { work, mergeBase } = e2eRepo(sb, { suites: [] }, 0);
    checks(sb, work, ['desktop-e2e']);
    expect(readJson<ChecksJson>(join(sb.sync, 'checks.json')).ran).toEqual([
      { name: 'desktop-e2e', status: 'pass' },
    ]);
    const pnpm = calls(sb).filter(c => c.startsWith('pnpm '));
    expect(pnpm).toContain('pnpm exec playwright install chromium [CI=]');
    expect(pnpm).toContain('pnpm -C desktop build:e2e [CI=]');
    expect(pnpm).toContain(
      `pnpm exec playwright test --project=smoke --list --reporter=json --pass-with-no-tests --only-changed=${mergeBase} [CI=]`
    );
    expect(pnpm).toContain(
      'pnpm exec playwright test --project=smoke --update-snapshots=none --reporter=list,json ' +
        'tests/e2e/smoke.spec.ts tests/e2e/workflow-local-controls.spec.ts [CI=1]'
    );
    expect(calls(sb)).toContain('just desktop-install-ci');
  });

  it('records a pixel diff against only the macOS baseline as a warning, not a failure', () => {
    const sb = makeSandbox();
    const { work } = e2eRepo(sb, failedReport(DARWIN_DIFF), 1);
    checks(sb, work, ['desktop-e2e', 'rust-fmt']);
    const result = readJson<ChecksJson & { warnings: { name: string; warning: string }[] }>(
      join(sb.sync, 'checks.json')
    );
    expect(result.passed).toBe(true);
    expect(result.failed).toEqual([]);
    expect(result.ran).toEqual([
      { name: 'desktop-e2e', status: 'warn' },
      { name: 'rust-fmt', status: 'pass' },
    ]);
    expect(result.warnings).toEqual([
      {
        name: 'desktop-e2e',
        warning: expect.stringContaining('template variable autocomplete'),
      },
    ]);
  });

  it('fails the desktop specs on a Linux baseline diff or any other error', () => {
    for (const message of [
      DARWIN_DIFF.replace('-darwin.png', '-linux.png'),
      'Error: expect(locator).toBeVisible() failed',
    ]) {
      const sb = makeSandbox();
      const { work } = e2eRepo(sb, failedReport(message), 1);
      checks(sb, work, ['desktop-e2e']);
      expect(readJson<ChecksJson>(join(sb.sync, 'checks.json')).ran).toEqual([
        { name: 'desktop-e2e', status: 'fail' },
      ]);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// merge-pr: merge on green, never on red, never a test pull request
// ---------------------------------------------------------------------------

describe('merge-pr node (executable)', () => {
  function runMerge(
    conclusion: string,
    test: boolean
  ): { sb: Sandbox; head: string; status: number | null; stdout: string; stderr: string } {
    const sb = makeSandbox();
    const work = cleanRepo(sb);
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({ repo: FORK_REPO, issue: ISSUE, test })
    );
    writeFileSync(
      join(sb.sync, 'pr.json'),
      JSON.stringify({ pr_url: `https://github.com/${FORK_REPO}/pull/77`, number: 77 })
    );
    writeFileSync(
      join(sb.sync, 'ci.json'),
      JSON.stringify({
        conclusion,
        failed: conclusion === 'failure' ? ['Security'] : [],
        attempt: 2,
      })
    );
    const head = git(sb, work, 'rev-parse', 'HEAD');
    const r = run(sb, render(bashOf('merge-pr'), sb.artifacts), { cwd: work });
    return { sb, head, ...r };
  }

  it('merges a green production PR with a merge commit and records it', () => {
    const r = runMerge('success', false);
    expect(r.status).toBe(0);
    expect(calls(r.sb)).toEqual([
      `gh pr merge 77 --repo ${FORK_REPO} --merge --match-head-commit ${r.head}`,
      `gh pr view 77 --repo ${FORK_REPO} --json state,mergeCommit`,
    ]);
    expect(JSON.parse(r.stdout)).toEqual({
      merged: true,
      merged_by: 'archon',
      merge_commit: 'd'.repeat(40),
    });
  });

  it('never merges a red PR, and fails with the reason', () => {
    const r = runMerge('failure', false);
    expect(r.status).toBe(1);
    expect(calls(r.sb)).toEqual([]);
    expect(readFileSync(join(r.sb.sync, 'merge-problems.txt'), 'utf-8')).toContain(
      'failed checks: Security. The pull request is not merged.'
    );
  });

  it('never merges a test PR, even when its CI passed', () => {
    const r = runMerge('success', true);
    expect(r.status).toBe(0);
    expect(calls(r.sb)).toEqual([]);
    expect(JSON.parse(r.stdout)).toEqual({ merged: false, test: true });
  });
});
