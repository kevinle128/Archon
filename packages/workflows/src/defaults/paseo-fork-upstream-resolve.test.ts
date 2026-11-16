/**
 * Tests for the bundled `paseo-fork-upstream-resolve` workflow and its commands.
 *
 * The bash bodies are executed for real: each test renders a node through the same
 * substitution functions the executor uses (`substituteWorkflowVariables` with
 * `shellSafe`, then `substituteNodeOutputRefs` with bash quoting) and runs it with
 * fake `gh`, `git` network commands, `curl`, `sleep`, `node`, `npm` and `npx` on PATH. No
 * test reaches the network: the fake `git` blocks every fetch or push it does not
 * redirect to a local repository, and the fake `gh` fails on any unexpected call.
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
// A full local check run on the Mac mini, measured cold (no node_modules), and the
// node limits chosen from it.
const MEASURED_FULL_RUN_MS = 0;
const CHECK_NODE_TIMEOUT = 2_700_000;
const AGENT_IDLE_TIMEOUT = 1_200_000;
// Tests that run the final checks run a full checks.sh with fake tools: about
// twenty checks, each with its own watchdog process, about 1 s on a machine at
// load 25 and well under that when idle. They do no network or database I/O.
const FULL_CHECK_RUN_BUDGET = 20_000;
// The step lines of the fork CI that checks.sh reads its `node --test` files from.
const CI_YML = [
  'jobs:',
  '  changes:',
  '    steps:',
  '      - name: Validate CI contracts',
  '        run: node --test scripts/ci-workflow.test.mjs scripts/daemon-launch-contract.test.mjs',
  '  typecheck:',
  '    steps:',
  '      - name: Verify fork desktop manifest checks',
  '        run: node --test scripts/fork-desktop-manifest.test.mjs',
  '      - name: Verify built-in plugins from built output',
  '        run: node --test scripts/builtin-plugins-dist.test.mjs',
  '      - name: Verify fork sync conflict report',
  '        run: node --test scripts/fork-sync-conflict-report.test.mjs',
  '',
].join('\n');

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
  "run rerun")
    # $FAKE_RERUN_RESULT: ok (default) accepts the re-run; any other value refuses it.
    if [ "\${FAKE_RERUN_RESULT:-ok}" = ok ]; then exit 0; fi
    echo "run cannot be rerun" >&2; exit 1 ;;
  "pr view")
    case "$*" in
      *"--json state -q .state"*) echo "\${FAKE_PR_STATE:-OPEN}" ;;
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

// The cleanup sweep reads run states from the local Archon server. A run id with
// $FAKE_CURL_DIR/<id>.code answers that HTTP code (and <id>.json as the body);
// any other request fails like an unreachable server (code 000).
const FAKE_CURL = `#!/bin/bash
printf '%s\\n' "curl $*" >> "$FAKE_LOG"
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    -w|-m) shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
id=\${url##*/}
if [ -f "$FAKE_CURL_DIR/$id.code" ]; then
  if [ -n "$out" ] && [ -f "$FAKE_CURL_DIR/$id.json" ]; then cp "$FAKE_CURL_DIR/$id.json" "$out"; fi
  cat "$FAKE_CURL_DIR/$id.code"
  exit 0
fi
printf '000'
exit 7
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
  mkdirSync(join(root, 'curl'), { recursive: true });
  writeExecutable(join(bin, 'gh'), FAKE_GH);
  writeExecutable(join(bin, 'curl'), FAKE_CURL);
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
      // prepare starts the detached cleanup watcher; in tests it stops at once.
      CLEANUP_WATCH_POLLS: '0',
      FAKE_LOG: log,
      FAKE_REPO: FORK_REPO,
      FAKE_ISSUE_JSON: join(root, 'issue.json'),
      FAKE_ISSUE_LIST_JSON: join(root, 'issue-list.json'),
      FAKE_PR_LIST_JSON: join(root, 'pr-list.json'),
      FAKE_PR_VIEW_JSON: join(root, 'pr-view.json'),
      FAKE_CHECKS_DIR: join(root, 'checks'),
      FAKE_CURL_DIR: join(root, 'curl'),
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
      'fix-checks',
      'publish',
      'create-pr',
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
      'verify-pr': 'all_success',
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
      'verify-pr': ['create-pr'],
      'wait-ci': ['verify-pr'],
      'rerun-ci': ['wait-ci'],
      'fix-ci': ['rerun-ci'],
      'merge-pr': ['wait-ci', 'rerun-ci', 'fix-ci'],
      finalize: ['wait-ci', 'rerun-ci', 'fix-ci', 'merge-pr'],
    });
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
    expect(attempt.command).toBe('paseo-fork-resolve-upstream-merge');
    expect(attempt.prompt_suffix).toContain('follow the "Fix pass"');
    const text = BUNDLED_COMMANDS['paseo-fork-resolve-upstream-merge'] ?? '';
    expect(text).toContain('## Fix pass');
    expect(text).toContain('Do not delete fork features to make the');
    expect(text).toContain('never take one whole side');
  });

  it('fixes CI in a bounded loop group that ends before max_iterations', () => {
    const group = loopGroupOf('fix-ci');
    expect(group.max_iterations).toBe(3);
    expect(group.nodes.map(n => n.id)).toEqual(['pr-open', 'fix-ci-attempt', 'wait-ci-again']);
    expect(group.nodes[1]?.depends_on).toEqual(['pr-open']);
    expect(group.nodes[1]?.when).toBe("$pr-open.output.open == 'true'");
    expect(group.until_bash).toContain('.attempt >= 2');
  });

  it('gives every slow bash node an explicit timeout', () => {
    const timeouts = Object.fromEntries(
      ['prepare', 'check', 'publish', 'verify-pr', 'wait-ci', 'rerun-ci', 'finalize'].map(id => [
        id,
        nodeById(id).timeout,
      ])
    );
    expect(timeouts).toEqual({
      prepare: 1_800_000,
      check: CHECK_NODE_TIMEOUT,
      publish: 2_700_000,
      'verify-pr': 600_000,
      'wait-ci': 6_300_000,
      'rerun-ci': 6_600_000,
      finalize: 300_000,
    });
    expect(loopGroupOf('fix-checks').nodes[1]?.timeout).toBe(CHECK_NODE_TIMEOUT);
    expect(loopGroupOf('fix-ci').nodes[0]?.timeout).toBe(300_000);
    expect(loopGroupOf('fix-ci').nodes[2]?.timeout).toBe(6_000_000);
  });

  it('gives the agent nodes that run a full check run an idle timeout above that run', () => {
    // The agent is silent while checks.sh runs inside its turn, so the idle
    // timeout must outlast a whole full run of the checks.
    const resolve = nodeById('resolve') as DagNode & { idle_timeout?: number };
    const fixPass = loopGroupOf('fix-checks').nodes[0] as DagNode & { idle_timeout?: number };
    const fixCi = loopGroupOf('fix-ci').nodes[1] as DagNode & { idle_timeout?: number };
    expect(resolve.idle_timeout).toBe(AGENT_IDLE_TIMEOUT);
    expect(fixPass.idle_timeout).toBe(AGENT_IDLE_TIMEOUT);
    expect(fixCi.idle_timeout).toBe(AGENT_IDLE_TIMEOUT);
    expect(AGENT_IDLE_TIMEOUT).toBeGreaterThan(MEASURED_FULL_RUN_MS);
    expect(CHECK_NODE_TIMEOUT).toBeGreaterThan(MEASURED_FULL_RUN_MS);
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

  it('runs test suites and Playwright only inside the check script, never from a prompt', () => {
    const suite = /npm run test\b|npm test\b|playwright/i;
    expect(heredoc(bashOf('prepare'), 'CHECKS_SH')).toMatch(suite);
    // Outside checks.sh the workflow names them only in its description.
    const checksBlock =
      /^ {6}cat > "\$SYNC_DIR\/checks\.sh" <<'CHECKS_SH'\n[\s\S]*?\n {6}CHECKS_SH\n/m;
    expect(YAML_TEXT).toMatch(checksBlock);
    const outside = YAML_TEXT.replace(checksBlock, '');
    for (const line of outside.split('\n')) {
      if (suite.test(line)) expect(line).toMatch(/^ {8}\S.*Playwright specs/);
    }
    // The commands name the forbidden commands only to forbid them (on the line
    // or the line before, where a sentence wraps); the commands also name CI's
    // Playwright jobs and artifact and the check names that run Playwright.
    const allowed =
      /never|playwright-results|Playwright (specs|lists|screenshot)|e2e-app|e2e-website|CI runs the app/i;
    for (const name of COMMAND_NAMES) {
      const lines = (BUNDLED_COMMANDS[name] ?? '').split('\n');
      lines.forEach((line, i) => {
        if (!/npm run test\b|npm test\b|playwright/i.test(line)) return;
        expect(`${lines[i - 1] ?? ''}\n${line}`).toMatch(
          /npm run test\b|npm test\b/.test(line) ? /never/i : allowed
        );
      });
    }
  });

  it('collects every failing test in each fix pass and never weakens a test', () => {
    const suffix =
      (loopGroupOf('fix-checks').nodes[0] as DagNode & { prompt_suffix?: string }).prompt_suffix ??
      '';
    expect(suffix).toContain('list every failing test');
    expect(suffix).toContain('fix all');
    const resolveText = BUNDLED_COMMANDS['paseo-fork-resolve-upstream-merge'] ?? '';
    expect(resolveText).toContain('each to its end');
    expect(resolveText).toContain('Fix all of them in this pass.');
    const fixCi = BUNDLED_COMMANDS['paseo-fork-fix-ci'] ?? '';
    expect(fixCi).toContain('read each\nlog to its end');
    expect(fixCi).toContain('Fix all of them in\nthis pass');
    expect(fixCi).toContain('## Failures that are only timing');
    expect(fixCi).toContain('gh run rerun <run-id> --repo "$repo" --failed');
    expect(fixCi).toContain('playwright-results-<N>');
    expect(fixCi).toContain('*-actual.png');
    expect(fixCi).toContain('Never make a Linux baseline\nfrom a local render');
    expect(fixCi).toContain('Never delete a test, skip a test');
    expect(fixCi).toContain('raise a timeout, pixel or ratio tolerance');
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
  const checkOut: NodeOutput = completed({ passed: true }, ['passed']);
  const prOut: NodeOutput = completed({ pr_url: 'p', number: 77 });
  const ciOut = (conclusion: string): NodeOutput =>
    completed({ pr_url: 'p', number: 77, conclusion, failed: [], checks_url: 'c', attempt: 0 });
  const rerunOut = (fix: boolean): NodeOutput => completed({ rerun: true, fix }, ['fix']);

  it('goes from a passing check straight to publish, the PR, CI and the merge', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: checkOut,
      'verify-pr': prOut,
      'wait-ci': ciOut('success'),
    });
    expect(d.check).toBe('run');
    expect(d.publish).toBe('run');
    expect(d['create-pr']).toBe('run');
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
      'verify-pr': prOut,
      'wait-ci': ciOut('success'),
    });
    expect(d['fix-checks']).toBe('run');
    expect(d.publish).toBe('run');
    expect(d.finalize).toBe('run');
  });

  it('skips the fix-checks loop when the final checks pass', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: completed({ passed: true }, ['passed']),
      'verify-pr': prOut,
      'wait-ci': ciOut('success'),
    });
    expect(d['fix-checks']).toBe('skip:when');
    expect(d.publish).toBe('run');
  });

  it('re-runs a failed CI first, fixes only when it still fails, and merge-pr decides last', () => {
    for (const fix of [false, true]) {
      const d = simulate({
        resolve: resolveOut(true),
        check: checkOut,
        'verify-pr': prOut,
        'wait-ci': ciOut('failure'),
        'rerun-ci': rerunOut(fix),
      });
      expect(d['rerun-ci']).toBe('run');
      expect(d['fix-ci']).toBe(fix ? 'run' : 'skip:when');
      expect(d['merge-pr']).toBe('run');
      expect(d.finalize).toBe('run');
    }
  });

  it('skips the re-run and fix-ci (not fails) when a human merged or closed the PR during the CI wait', () => {
    for (const conclusion of ['merged', 'closed']) {
      const d = simulate({
        resolve: resolveOut(true),
        check: checkOut,
        'verify-pr': prOut,
        'wait-ci': ciOut(conclusion),
      });
      expect(d['rerun-ci']).toBe('skip:when');
      expect(d['fix-ci']).toBe('skip:trigger');
      expect(d['merge-pr']).toBe('run');
      expect(d.finalize).toBe('run');
    }
  });

  it('merges nothing and fixes nothing, but still runs finalize, when the re-run fails', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: checkOut,
      'verify-pr': prOut,
      'wait-ci': ciOut('failure'),
      'rerun-ci': { state: 'failed', output: '', error: 'gh failed' },
    });
    expect(d['fix-ci']).toBe('skip:trigger');
    expect(d['merge-pr']).toBe('skip:trigger');
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

  it('still runs finalize after publish fails', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: checkOut,
      publish: { state: 'failed', output: '', error: 'push failed' },
    });
    for (const id of ['create-pr', 'verify-pr', 'wait-ci', 'rerun-ci', 'fix-ci', 'merge-pr']) {
      expect(d[id]).toBe('skip:trigger');
    }
    expect(d.finalize).toBe('run');
  });

  it('still runs finalize after verify-pr fails, and merges nothing', () => {
    const d = simulate({
      resolve: resolveOut(true),
      check: checkOut,
      'verify-pr': { state: 'failed', output: '', error: 'contract' },
    });
    expect(d['wait-ci']).toBe('skip:trigger');
    expect(d['rerun-ci']).toBe('skip:trigger');
    expect(d['fix-ci']).toBe('skip:trigger');
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
/**
 * The fork CI file that checks.sh reads its `node --test` files from, and the app
 * package folder that the app E2E check runs Playwright in.
 */
function writeCiYml(repo: string): void {
  mkdirSync(join(repo, '.github/workflows'), { recursive: true });
  writeFileSync(join(repo, '.github/workflows/ci.yml'), CI_YML);
  mkdirSync(join(repo, 'packages/app'), { recursive: true });
  writeFileSync(join(repo, 'packages/app/playwright.config.ts'), 'export default {};\n');
}

/** The run record fields of sync.json, under a state folder of the sandbox. */
function runRecord(sb: Sandbox): { runs_root: string; run_dir: string } {
  const runsRoot = join(sb.root, 'state', 'sync-runs');
  return { runs_root: runsRoot, run_dir: join(runsRoot, RUN_ID) };
}

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
  writeCiYml(origin);
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
      env?: NodeJS.ProcessEnv;
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
      env: {
        ...(repos ? { FAKE_UPSTREAM_DIR: repos.upstream, FAKE_ORIGIN_DIR: repos.origin } : {}),
        ...options.env,
      },
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
      runs_root: join(sb.artifacts, 'state', 'sync-runs'),
      run_dir: join(sb.artifacts, 'state', 'sync-runs', RUN_ID),
    });
    expect(readJson<unknown>(join(sb.sync, 'sync.json'))).toEqual(sync);
    // The run records its worktree outside the worktree, for the cleanup sweep.
    expect(
      readFileSync(join(sb.artifacts, 'state', 'sync-runs', RUN_ID, 'worktree'), 'utf-8').trim()
    ).toBe(realpathSync(repos.work));
    // prepare starts one detached cleanup watcher for its run.
    const watchLog = join(sb.artifacts, 'state', 'sync-runs', RUN_ID, 'watch.log');
    for (let i = 0; i < 50 && !readFileSync(watchLog, 'utf-8').includes('watching'); i++) {
      Bun.sleepSync(100);
    }
    expect(readFileSync(watchLog, 'utf-8')).toContain(`cleanup: watching the run ${RUN_ID}`);
    expect(
      readFileSync(join(sb.artifacts, 'state', 'sync-runs', RUN_ID, 'watch.pid'), 'utf-8').trim()
    ).toMatch(/^[0-9]+$/);
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

  it('ends while its cleanup watcher still runs (no open stdout or stderr is left behind)', () => {
    const sb = makeSandbox();
    const repos = makeForkRepos(sb);
    // A real one-second sleep keeps the watcher alive for about ten seconds.
    const bin2 = join(sb.root, 'bin2');
    mkdirSync(bin2);
    writeExecutable(join(bin2, 'sleep'), '#!/bin/bash\nexec /bin/sleep 1\n');
    const started = Date.now();
    const r = runPrepare(sb, repos, {
      env: { CLEANUP_WATCH_POLLS: '10', PATH: `${bin2}:${sb.env.PATH ?? ''}` },
    });
    const elapsed = Date.now() - started;
    const pidFile = join(sb.artifacts, 'state', 'sync-runs', RUN_ID, 'watch.pid');
    const pid = Number(readFileSync(pidFile, 'utf-8').trim());
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive) process.kill(pid, 'SIGTERM');
    expect(r.status).toBe(0);
    expect(alive).toBe(true);
    expect(elapsed).toBeLessThan(8000);
  }, 20_000);

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

  interface ChecksJson {
    passed: boolean;
    failed: string[];
    warnings: Array<{ name: string; warning: string }>;
    ran: Array<{ name: string; status: string }>;
    full: boolean;
  }

  // Every check of a full run, in the order checks.sh runs them.
  const FULL_RUN = [
    'install',
    'format-check',
    'lint',
    'dependency-checks',
    'build-server',
    'typecheck',
    'typecheck-examples',
    'node-tests',
    'pack-check',
    'test-relay',
    'test-sdk',
    'test-website',
    'test-builtin-plugins',
    'test-server',
    'test-desktop',
    'test-app',
    'test-cli-unit',
    'test-cli-local',
    'e2e-app',
  ];

  const SECRETS = [
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'PASEO_CLI_TEST_SHARD',
    'PASEO_CLI_TEST_SHARD_TOTAL',
  ];

  /**
   * A repository with the fork CI file, the app package folder and a few source
   * files, plus fake node, npm and npx that record every call, its arguments,
   * folder and environment. A tool call whose text holds `failing` fails, one
   * that holds `messy` changes the tree, one that holds `hang` sleeps (and writes
   * its pid to FAKE_HANG_PID), and one that holds `warn` writes a check warning.
   * `npx playwright test ... --list` prints the file FAKE_PW_LIST when it is set.
   */
  function setup(
    options: {
      failing?: string;
      nodeMajor?: string;
      messy?: string;
      hang?: string;
      warn?: string;
    } = {}
  ): {
    sb: Sandbox;
    work: string;
    script: string;
    mergeBase: string;
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
    writeCiYml(work);
    git(sb, work, 'add', '.');
    git(sb, work, 'commit', '-q', '-m', 'fixture');
    const mergeBase = git(sb, work, 'rev-parse', 'HEAD');
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({
        files: ['src/grid.ts', 'src/panel.tsx', 'src/gone.ts'],
        merge_base: mergeBase,
        ...runRecord(sb),
      })
    );
    const script = join(sb.sync, 'checks.sh');
    writeFileSync(script, CHECKS_SH);
    const pick = (value: string | undefined): string => value || '__none__';
    const envNames = ['NODE_ENV', 'CI', 'PLAYWRIGHT_BROWSERS_PATH', ...SECRETS];
    const fake = (tool: string): string => `#!/bin/bash
printf '%s\\n' "${tool} $*" >> "$FAKE_LOG"
printf '%s' "${tool}" >> "$FAKE_LOG.env"
for v in ${envNames.join(' ')}; do printf ' %s=%s' "$v" "\${!v-unset}" >> "$FAKE_LOG.env"; done
echo >> "$FAKE_LOG.env"
if [ "$1" != -p ]; then printf '[%s]' "${tool}" "$@" >> "$FAKE_LOG.args"; echo >> "$FAKE_LOG.args"; fi
printf '%s %s\\n' "${tool}" "$PWD" >> "$FAKE_LOG.cwd"
if [ "$1" = -p ]; then echo ${options.nodeMajor ?? '22'}; exit 0; fi
if [ "$1" = --version ]; then echo v${options.nodeMajor ?? '22'}.0.0; exit 0; fi
case "${tool} $*" in *"${pick(options.messy)}"*)
  # A check that rewrites a tracked file, stages and deletes others, and leaves build output.
  echo changed > src/grid.ts
  echo staged > src/panel.tsx && git add src/panel.tsx
  rm -f src/grid.test.ts
  mkdir -p out && echo built > out/build.txt ;;
esac
case "${tool} $*" in *"${pick(options.hang)}"*) echo $$ > "$FAKE_HANG_PID"; exec /bin/sleep 300 ;; esac
case "${tool} $*" in *"${pick(options.warn)}"*) echo "only a macOS difference" > "${join(sb.sync, 'check-warning')}" ;; esac
case "${tool} $*" in *"playwright test"*--list*) if [ -n "\${FAKE_PW_LIST:-}" ]; then cat "$FAKE_PW_LIST"; fi ;; esac
case "${tool} $*" in *"${pick(options.failing)}"*) echo "boom from ${tool}"; exit 1 ;; esac
exit 0
`;
    for (const tool of ['node', 'npm', 'npx']) writeExecutable(join(sb.bin, tool), fake(tool));
    return { sb, work, script, mergeBase };
  }

  function toolCalls(sb: Sandbox): string[] {
    return calls(sb).filter(c => !c.startsWith('node -p'));
  }

  it('runs every CI test job that works on macOS, in build order, on a full run', () => {
    const { sb, work, script } = setup({ failing: 'run lint' });
    const r = run(sb, `bash "${script}"`, { cwd: work });
    expect(r.status).toBe(0);
    const result = JSON.parse(r.stdout) as ChecksJson;
    expect(result.passed).toBe(false);
    expect(result.failed).toEqual(['lint']);
    expect(result.full).toBe(true);
    expect(result.warnings).toEqual([]);
    // No file under packages/website changed since the merge base.
    expect(result.ran.map(c => c.name)).toEqual(FULL_RUN);
    expect(readJson<unknown>(join(sb.sync, 'checks.json'))).toEqual(result);
    expect(readFileSync(join(sb.sync, 'checks.log'), 'utf-8')).toContain('boom from npm');
    expect(toolCalls(sb)).toEqual([
      'node scripts/npm-retry.mjs ci',
      'npm run format:check',
      'npm run lint',
      'npx --yes lockfile-lint --path package-lock.json --type npm --allowed-hosts npm --validate-https --validate-integrity',
      'npm audit signatures',
      'npm run build:server',
      'npm run typecheck',
      'npm run typecheck:examples --workspace=@getpaseo/client',
      'node --test scripts/ci-workflow.test.mjs scripts/daemon-launch-contract.test.mjs ' +
        'scripts/fork-desktop-manifest.test.mjs scripts/builtin-plugins-dist.test.mjs ' +
        'scripts/fork-sync-conflict-report.test.mjs',
      'npm pack --dry-run --ignore-scripts --workspace=@getpaseo/protocol',
      'npm pack --dry-run --ignore-scripts --workspace=@getpaseo/client',
      'npm pack --dry-run --ignore-scripts --workspace=@getpaseo/server',
      'npm run test --workspace=@getpaseo/relay',
      'npm run test --workspace=@getpaseo/plugin',
      'npm run test --workspace=@getpaseo/protocol',
      'npm run test --workspace=@getpaseo/client',
      'npm run test --workspace=@getpaseo/highlight',
      'npx vitest run packages/website/src --bail=1',
      'npm run test --workspace=@getpaseo/builtin-plugins',
      'npm run test --workspace=@getpaseo/server',
      'npm run test --workspace=@getpaseo/desktop',
      'npx playwright install chromium',
      'npm run build:app-deps',
      'npm run test --workspace=@getpaseo/app',
      'npm run test:unit --workspace=@getpaseo/cli',
      'npm run test:local --workspace=@getpaseo/cli',
      'npx playwright install chromium',
      'npm run build --workspace=@getpaseo/expo-two-way-audio',
      expect.stringMatching(/^npx playwright test --project=browser --list /),
      expect.stringMatching(/^npx playwright test --project=browser --update-snapshots=none /),
    ]);
    // No per-file test of a touched file runs: the package suites cover them.
    expect(toolCalls(sb).some(c => c.startsWith('npx vitest run src/'))).toBe(false);
  }, 30_000);

  it('runs every step of a check even when an earlier step fails, as CI steps do', () => {
    const { sb, work, script } = setup({ failing: 'workspace=@getpaseo/plugin' });
    const r = run(sb, `bash "${script}" test-sdk`, { cwd: work });
    expect((JSON.parse(r.stdout) as ChecksJson).failed).toEqual(['test-sdk']);
    expect(toolCalls(sb)).toEqual([
      'npm run test --workspace=@getpaseo/plugin',
      'npm run test --workspace=@getpaseo/protocol',
      'npm run test --workspace=@getpaseo/client',
      'npm run test --workspace=@getpaseo/highlight',
    ]);
  });

  it('adds the website Playwright specs when a file under packages/website changed since the merge base', () => {
    const { sb, work, script } = setup();
    mkdirSync(join(work, 'packages/website/src'), { recursive: true });
    writeFileSync(join(work, 'packages/website/src/page.astro'), 'x\n');
    git(sb, work, 'add', '.');
    git(sb, work, 'commit', '-q', '-m', 'website change');
    const r = run(sb, `bash "${script}"`, { cwd: work });
    const result = JSON.parse(r.stdout) as ChecksJson;
    expect(result.ran.map(c => c.name)).toEqual([...FULL_RUN, 'e2e-website']);
    expect(toolCalls(sb).slice(-2)).toEqual([
      'npx playwright install chromium webkit',
      'npm run test:e2e --workspace=@getpaseo/website',
    ]);
  }, 30_000);

  it('reads the node --test files from ci.yml, and fails node-tests when ci.yml names none', () => {
    const { sb, work, script } = setup();
    let r = run(sb, `bash "${script}" fork-script-tests`, { cwd: work });
    expect((JSON.parse(r.stdout) as ChecksJson).passed).toBe(true);
    expect(toolCalls(sb)).toEqual([
      'node --test scripts/fork-desktop-manifest.test.mjs scripts/fork-sync-conflict-report.test.mjs',
    ]);
    writeFileSync(
      join(work, '.github/workflows/ci.yml'),
      'jobs:\n  a:\n    steps:\n      - run: npm ci\n'
    );
    r = run(sb, `bash "${script}" node-tests`, { cwd: work });
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as ChecksJson).failed).toEqual(['node-tests']);
    expect(readFileSync(join(sb.sync, 'checks.log'), 'utf-8')).toContain(
      "found no 'run: node --test' test file for 'all' in .github/workflows/ci.yml"
    );
  });

  it('runs the app specs that changed since the merge base, in the browser project, plus the smoke spec', () => {
    const { sb, work, script, mergeBase } = setup();
    const list = join(sb.root, 'pw-list.json');
    writeFileSync(
      list,
      JSON.stringify({
        suites: [
          { title: 'workspace-lifecycle.spec.ts', file: 'workspace-lifecycle.spec.ts', specs: [] },
          { title: 'pinned-grid-deck.spec.ts', file: 'pinned-grid-deck.spec.ts', specs: [] },
          { title: 'pinned-grid-deck.spec.ts', file: 'pinned-grid-deck.spec.ts', specs: [] },
        ],
      })
    );
    const r = run(sb, `bash "${script}" e2e-app`, { cwd: work, env: { FAKE_PW_LIST: list } });
    expect((JSON.parse(r.stdout) as ChecksJson).ran).toEqual([{ name: 'e2e-app', status: 'pass' }]);
    expect(toolCalls(sb)).toEqual([
      'npx playwright install chromium',
      'npm run build --workspace=@getpaseo/expo-two-way-audio',
      `npx playwright test --project=browser --list --reporter=json --pass-with-no-tests --only-changed=${mergeBase}`,
      'npx playwright test --project=browser --update-snapshots=none ' +
        'e2e/browser/workspace-lifecycle.spec.ts e2e/browser/pinned-grid-deck.spec.ts',
    ]);
    const real = realpathSync(work);
    const npxDirs = readFileSync(`${sb.log}.cwd`, 'utf-8')
      .split('\n')
      .filter(line => line.startsWith('npx '))
      .map(line => line.slice('npx '.length));
    expect(npxDirs).toEqual([real, join(real, 'packages/app'), join(real, 'packages/app')]);
    // Only the spec run gets the CI settings; browsers go to the shared state folder.
    const envLines = readFileSync(`${sb.log}.env`, 'utf-8').trim().split('\n');
    const browsers = join(sb.root, 'state', 'ms-playwright');
    expect(envLines.filter(l => l.startsWith('npx ')).map(l => / CI=(\S+)/.exec(l)?.[1])).toEqual([
      'unset',
      'unset',
      '1',
    ]);
    for (const line of envLines.filter(l => !l.startsWith('node '))) {
      expect(line).toContain(` PLAYWRIGHT_BROWSERS_PATH=${browsers} `);
    }
    expect(existsSync(join(work, 'ms-playwright'))).toBe(false);
  });

  it('runs only the smoke spec when no app spec changed', () => {
    const { sb, work, script } = setup();
    run(sb, `bash "${script}" e2e-app`, { cwd: work });
    expect(toolCalls(sb).at(-1)).toBe(
      'npx playwright test --project=browser --update-snapshots=none e2e/browser/workspace-lifecycle.spec.ts'
    );
  });

  it('removes provider keys and CLI shard settings from every check, and NODE_ENV too', () => {
    // A server started with NODE_ENV=production would make npm ci skip devDependencies
    // (patch-package, the type checker, the linter), so every check would fail. The
    // keys would let a test call a paid provider; CI runs without them.
    const { sb, work, script } = setup();
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    for (const name of SECRETS) env[name] = 'secret-value';
    const r = run(sb, `bash "${script}" install test-server test-cli-local e2e-app`, {
      cwd: work,
      env,
    });
    expect(r.status).toBe(0);
    const envLines = readFileSync(`${sb.log}.env`, 'utf-8').trim().split('\n');
    expect(envLines.length).toBeGreaterThan(4);
    for (const line of envLines) {
      expect(line).toContain(' NODE_ENV=unset');
      for (const name of SECRETS) expect(line).toContain(` ${name}=unset`);
      expect(line).not.toContain('secret-value');
    }
  });

  it('stops a hung check at its limit, with its processes, and reports it as timed out', () => {
    const { sb, work, script } = setup({ hang: 'run test --workspace=@getpaseo/server' });
    const pidFile = join(sb.root, 'hang.pid');
    const started = Date.now();
    const r = run(sb, `bash "${script}" test-server lint`, {
      cwd: work,
      env: { CHECK_TIMEOUT_SECONDS: '2', FAKE_HANG_PID: pidFile },
    });
    const elapsed = Date.now() - started;
    expect(r.status).toBe(0);
    const result = readJson<ChecksJson>(join(sb.sync, 'checks.json'));
    expect(result.passed).toBe(false);
    expect(result.failed).toEqual(['test-server']);
    expect(result.ran).toEqual([
      { name: 'test-server', status: 'timeout' },
      { name: 'lint', status: 'pass' },
    ]);
    expect(r.stderr).toContain('check test-server: timeout');
    expect(readFileSync(join(sb.sync, 'checks.log'), 'utf-8')).toContain(
      'checks: test-server timed out after 2 s; its processes were stopped'
    );
    // The hung process (the fake npm, now /bin/sleep) is gone, and the run did
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

  it('gives the related app specs about 20 minutes and every other check 15 minutes', () => {
    expect(CHECKS_SH).toContain('e2e-app) echo 1200 ;;');
    expect(CHECKS_SH).toContain('*) echo 900 ;;');
  });

  const HAS_LOCKF =
    spawnSync('bash', ['-c', 'command -v lockf'], { encoding: 'utf8' }).status === 0;

  it('holds the shared build lock while a check runs, and frees it afterwards', () => {
    if (!HAS_LOCKF) return; // lockf exists on macOS, where the mini runs the checks
    const { sb, work, script } = setup();
    const lock = join(sb.root, 'build.lock');
    // The fake just reports whether the lock is free while the check runs.
    writeExecutable(
      join(sb.bin, 'npm'),
      `#!/bin/bash\nif lockf -s -t 0 "${lock}" true; then echo free >> "$FAKE_LOG"; else echo held >> "$FAKE_LOG"; fi\nexit 0\n`
    );
    run(sb, `bash "${script}" lint`, { cwd: work, env: { FORK_SYNC_BUILD_LOCK: lock } });
    expect(calls(sb)).toContain('held');
    expect(spawnSync('lockf', ['-s', '-t', '0', lock, 'true']).status).toBe(0);
  });

  it('does not run a check while a release build holds the lock', () => {
    if (!HAS_LOCKF) return;
    const { sb, work, script } = setup();
    const lock = join(sb.root, 'build.lock');
    const holder = spawn('lockf', ['-k', lock, '/bin/sleep', '20'], { stdio: 'ignore' });
    try {
      spawnSync('/bin/sleep', ['0.5']);
      run(sb, `bash "${script}" lint`, {
        cwd: work,
        env: { FORK_SYNC_BUILD_LOCK: lock, BUILD_LOCK_WAIT_SECONDS: '1' },
      });
      expect(readJson<ChecksJson>(join(sb.sync, 'checks.json')).ran).toEqual([
        { name: 'lint', status: 'fail' },
      ]);
      expect(calls(sb)).not.toContain('npm run lint');
      expect(readFileSync(join(sb.sync, 'checks.log'), 'utf-8')).toContain('a release build runs');
    } finally {
      holder.kill('SIGKILL');
    }
  }, 30_000);

  it('records a passing check that wrote a warning as warn, which does not fail the checks', () => {
    const { sb, work, script } = setup({ warn: 'run lint' });
    const r = run(sb, `bash "${script}" lint format-check`, { cwd: work });
    expect(r.status).toBe(0);
    const result = JSON.parse(r.stdout) as ChecksJson;
    expect(result).toEqual({
      passed: true,
      failed: [],
      warnings: [{ name: 'lint', warning: 'only a macOS difference' }],
      ran: [
        { name: 'lint', status: 'warn' },
        { name: 'format-check', status: 'pass' },
      ],
      full: false,
    });
    expect(existsSync(join(sb.sync, 'check-warning'))).toBe(false);
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
      warnings: [],
      ran: [
        { name: 'lint', status: 'pass' },
        { name: 'vitest:src/grid.test.ts', status: 'pass' },
      ],
      full: false,
    });
    expect(toolCalls(sb)).toEqual(['npm run lint', 'npx vitest run src/grid.test.ts --bail=1']);
  });

  it('passes a test file path with spaces or non-ASCII characters as one safe argument', () => {
    const { sb, work, script } = setup();
    for (const f of ['src/naïve grid.test.ts', 'pkg/-x/a.test.ts', 'pkg/vitest.config.ts']) {
      mkdirSync(dirname(join(work, f)), { recursive: true });
      writeFileSync(join(work, f), 'x\n');
    }
    const r = run(sb, `bash "${script}" "$@"`, {
      cwd: work,
      args: ['vitest:src/naïve grid.test.ts', 'vitest:pkg/-x/a.test.ts'],
    });
    expect(r.status).toBe(0);
    const vitestCalls = readFileSync(`${sb.log}.args`, 'utf-8')
      .split('\n')
      .filter(line => line.startsWith('[npx]'));
    // A path that starts with a dash inside a package gets ./, so vitest never
    // reads it as an option.
    expect(vitestCalls).toEqual([
      '[npx][vitest][run][src/naïve grid.test.ts][--bail=1]',
      '[npx][vitest][run][./-x/a.test.ts][--bail=1]',
    ]);
  });

  it('runs a test file from the nearest folder with its own vitest config', () => {
    // packages/app defines globals such as __DEV__ only in its own vitest config,
    // so a run from the repo root fails before any test starts.
    const { sb, work, script } = setup();
    for (const f of ['packages/app/vitest.config.ts', 'packages/app/src/stores/store.test.ts']) {
      mkdirSync(dirname(join(work, f)), { recursive: true });
      writeFileSync(join(work, f), 'x\n');
    }
    const r = run(
      sb,
      `bash "${script}" vitest:packages/app/src/stores/store.test.ts vitest:src/grid.test.ts`,
      { cwd: work }
    );
    expect(r.status).toBe(0);
    const vitestCalls = readFileSync(`${sb.log}.args`, 'utf-8')
      .split('\n')
      .filter(line => line.startsWith('[npx]'));
    expect(vitestCalls).toEqual([
      '[npx][vitest][run][src/stores/store.test.ts][--bail=1]',
      '[npx][vitest][run][src/grid.test.ts][--bail=1]',
    ]);
    const npxDirs = readFileSync(`${sb.log}.cwd`, 'utf-8')
      .split('\n')
      .filter(line => line.startsWith('npx '))
      .map(line => line.slice('npx '.length));
    const real = realpathSync(work);
    expect(npxDirs).toEqual([join(real, 'packages/app'), real]);
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

  it('fails as a bad setup when sync.json names no merge base or run record', () => {
    const { sb, work, script } = setup();
    const syncPath = join(sb.sync, 'sync.json');
    const sync = readJson<Record<string, unknown>>(syncPath);
    for (const drop of ['merge_base', 'run_dir']) {
      writeFileSync(syncPath, JSON.stringify({ ...sync, [drop]: undefined }));
      const r = run(sb, `bash "${script}" lint`, { cwd: work });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('sync.json names no run_dir or merge_base');
    }
    writeFileSync(syncPath, JSON.stringify({ ...sync, merge_base: SHA_A }));
    const r = run(sb, `bash "${script}" lint`, { cwd: work });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`the merge base ${SHA_A} is not a commit`);
    expect(toolCalls(sb)).toEqual([]);
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
    options: { failing?: string; notes?: string; dirty?: boolean } = {}
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

  it(
    'fails before asking anyone when the resolver left a change for the engine to commit',
    () => {
      const r = runCheck({ resolved: true, question: '' }, { dirty: true });
      expect(r.status).toBe(1);
      expect(readFileSync(join(r.sb.sync, 'guard-failure.txt'), 'utf-8')).toContain(
        'archon evidence: resolve end'
      );
      expect(calls(r.sb)).toEqual([]);
    },
    FULL_CHECK_RUN_BUDGET
  );

  it(
    'fails without asking anyone or commenting when the resolver cannot resolve',
    () => {
      const r = runCheck({ resolved: false, question: "Keep the fork's `grid` or upstream's?" });
      expect(r.status).toBe(1);
      const reason =
        "The resolver could not resolve the merge: Keep the fork's `grid` or upstream's?";
      expect(r.stderr).toContain(reason);
      expect(readFileSync(join(r.sb.sync, 'check-failure.txt'), 'utf-8').trim()).toBe(reason);
      expect(calls(r.sb)).toEqual([]);
    },
    FULL_CHECK_RUN_BUDGET
  );

  it(
    'passes without asking anyone when the branch passes the final checks',
    () => {
      const r = runCheck({ resolved: true, question: '' });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ passed: true });
      expect(calls(r.sb)).toEqual([]);
      expect(existsSync(join(r.sb.sync, 'check-failure.txt'))).toBe(false);
      expect(readJson(join(r.sb.sync, 'check-state.json'))).toEqual({ passed: true, attempt: 0 });
      expect(readJson<{ full: boolean }>(join(r.sb.sync, 'checks.json')).full).toBe(true);
    },
    FULL_CHECK_RUN_BUDGET
  );

  it(
    'hands failing final checks to the fix loop with the reason, and calls nothing on GitHub',
    () => {
      const r = runCheck({ resolved: true, question: '' }, { failing: 'run lint' });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ passed: false });
      expect(readJson(join(r.sb.sync, 'check-state.json'))).toEqual({ passed: false, attempt: 0 });
      const reason = readFileSync(join(r.sb.sync, 'check-failure.txt'), 'utf-8');
      expect(reason).toContain('The branch does not pass the final checks:');
      expect(reason).toContain('- local checks fail: lint');
      expect(calls(r.sb).filter(c => c.startsWith('gh '))).toEqual([]);
    },
    FULL_CHECK_RUN_BUDGET
  );

  it(
    'records a missing notes paragraph as a failed final check',
    () => {
      const r = runCheck({ resolved: true, question: '' }, { notes: 'nothing useful\n' });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ passed: false });
      expect(readFileSync(join(r.sb.sync, 'check-failure.txt'), 'utf-8')).toContain(
        'resolution.md has no paragraph for src/grid.ts'
      );
    },
    FULL_CHECK_RUN_BUDGET
  );

  it('recheck counts the fix pass and records a pass or a new reason', () => {
    for (const failing of [undefined, 'run lint']) {
      const r = runCheck({ resolved: true, question: '' }, { failing: 'run lint' });
      expect(JSON.parse(r.stdout)).toEqual({ passed: false });
      installToolchain(r.sb, failing);
      const recheck = loopGroupOf('fix-checks').nodes[1] as DagNode & { bash: string };
      const rr = run(r.sb, render(recheck.bash, r.sb.artifacts), {
        cwd: join(r.sb.root, 'work'),
      });
      expect(rr.status).toBe(0);
      const passed = failing === undefined;
      expect(JSON.parse(rr.stdout)).toEqual({ passed, attempt: 1 });
      expect(existsSync(join(r.sb.sync, 'check-failure.txt'))).toBe(!passed);
      if (!passed) {
        expect(readFileSync(join(r.sb.sync, 'check-failure.txt'), 'utf-8')).toContain(
          'The branch does not pass the final checks after 1 fix pass(es):'
        );
      }
    }
    // Four full check runs of about twenty checks each, every check with its own
    // watchdog process: about 1 s per run on an idle machine.
  }, 30_000);

  it(
    'ends the fix loop after a pass or after the second fix pass',
    () => {
      const until = loopGroupOf('fix-checks').until_bash;
      for (const [state, done] of [
        [{ passed: true, attempt: 1 }, true],
        [{ passed: false, attempt: 1 }, false],
        [{ passed: false, attempt: 2 }, true],
      ] as const) {
        const sb = makeSandbox();
        writeFileSync(join(sb.sync, 'check-state.json'), JSON.stringify(state));
        expect(run(sb, until).status === 0).toBe(done);
      }
    },
    FULL_CHECK_RUN_BUDGET
  );
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
  writeCiYml(work);
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
      merge_base: mergeBase,
      branch: `sync/upstream-${ISSUE}-abcdef01`,
      files,
      ...runRecord(sb),
    })
  );
  installSyncScripts(sb);
  installToolchain(sb);
  writeFileSync(
    join(sb.sync, 'checks.json'),
    JSON.stringify({ passed: true, failed: [], ran: [], full: true })
  );
  writeFileSync(join(sb.sync, 'check-state.json'), JSON.stringify({ passed: true, attempt: 0 }));
  return { sb, repos };
}

describe('final checks script (executable)', () => {
  const finalChecks = (sb: Sandbox, cwd: string): { status: number | null; stdout: string } =>
    run(sb, `bash "${join(sb.sync, 'final-checks.sh')}" "the test"`, { cwd });

  it(
    'passes for a committed merge with notes for every conflicted file',
    () => {
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
    },
    FULL_CHECK_RUN_BUDGET
  );

  it(
    'fails and records the problems when notes or markers are wrong',
    () => {
      const { sb, repos } = committedMerge();
      writeFileSync(join(sb.sync, 'resolution.md'), 'nothing about the file\n');
      writeFileSync(join(repos.work, 'src/grid.ts'), '<<<<<<< ours\nx\n>>>>>>> theirs\n');
      git(sb, repos.work, 'commit', '-q', '-am', 'bad');
      const r = finalChecks(sb, repos.work);
      expect(r.status).toBe(10);
      const problems = readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8');
      expect(problems).toContain('conflict markers remain in src/grid.ts');
      expect(problems).toContain('resolution.md has no paragraph for src/grid.ts');
    },
    FULL_CHECK_RUN_BUDGET
  );

  it(
    'checks conflicted paths that start with a dash or hold spaces as plain file names',
    () => {
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
    },
    FULL_CHECK_RUN_BUDGET
  );

  it('names a timed-out local check in the problems', () => {
    const { sb, repos } = committedMerge();
    writeFileSync(join(sb.sync, 'resolution.md'), '`src/grid.ts`: keeps both.\n');
    writeExecutable(
      join(sb.bin, 'npm'),
      `#!/bin/bash\ncase "$*" in *"run lint"*) exec /bin/sleep 300 ;; esac\nexit 0\n`
    );
    const r = run(sb, `bash "${join(sb.sync, 'final-checks.sh')}" "the test"`, {
      cwd: repos.work,
      // The limit applies to every check of the full run; the fake checks end at once.
      env: { CHECK_TIMEOUT_SECONDS: '3' },
    });
    expect(r.status).toBe(10);
    expect(readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8')).toContain(
      '- local checks fail: lint (timed out)'
    );
  }, 30_000);

  it(
    'fails when the merge commit does not carry the agreed message',
    () => {
      const { sb, repos } = committedMerge(['src/grid.ts'], 'Merge whatever');
      writeFileSync(join(sb.sync, 'resolution.md'), '`src/grid.ts`: keeps both.\n');
      const r = finalChecks(sb, repos.work);
      expect(r.status).toBe(10);
      expect(readFileSync(join(sb.sync, 'verify-problems.txt'), 'utf-8')).toContain(
        `the merge commit message is not "Merge getpaseo/paseo ${repos.upstreamSha.slice(0, 9)} into main"`
      );
    },
    FULL_CHECK_RUN_BUDGET
  );

  it(
    'fails while the merge is still uncommitted',
    () => {
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
    },
    FULL_CHECK_RUN_BUDGET
  );
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

  it('pushes nothing when the last final checks did not pass, and quotes their reason', () => {
    const { sb, repos } = committedMerge();
    writeFileSync(join(sb.sync, 'check-state.json'), JSON.stringify({ passed: false, attempt: 2 }));
    writeFileSync(join(sb.sync, 'check-failure.txt'), 'still failing: lint\n');
    const r = run(sb, render(bashOf('publish'), sb.artifacts), {
      cwd: repos.work,
      env: { FAKE_GIT_ALLOW_PUSH: '1' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('still failing: lint');
    expect(calls(sb).some(c => c.startsWith('git push'))).toBe(false);
  });

  it('never runs the final checks itself', () => {
    expect(bashOf('publish')).not.toContain('final-checks.sh');
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

  it('accepts a PR that meets the contract, edits nothing, and prints the PR without waiting for CI', () => {
    // The PR link must reach the run's status events while CI still runs.
    const { sb, work } = setup({});
    const r = verifyPr(sb, work);
    expect(r.status).toBe(0);
    const pr = { pr_url: `https://github.com/${FORK_REPO}/pull/77`, number: 77 };
    expect(JSON.parse(r.stdout)).toEqual(pr);
    expect(readJson<unknown>(join(sb.sync, 'pr.json'))).toEqual(pr);
    expect(existsSync(join(sb.sync, 'ci.json'))).toBe(false);
    expect(calls(sb).some(c => c.startsWith('gh pr checks'))).toBe(false);
    expect(calls(sb).some(c => c.startsWith('gh pr edit'))).toBe(false);
  });

  it('wait-ci then waits for the CI and prints the PR plus the CI result', () => {
    const { sb, work } = setup({});
    expect(verifyPr(sb, work).status).toBe(0);
    const r = run(sb, render(bashOf('wait-ci'), sb.artifacts), { cwd: work });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      pr_url: `https://github.com/${FORK_REPO}/pull/77`,
      number: 77,
      conclusion: 'success',
      failed: [],
      checks_url: `https://github.com/${FORK_REPO}/pull/77/checks`,
      attempt: 0,
    });
    expect(readJson<{ conclusion: string }>(join(sb.sync, 'ci.json')).conclusion).toBe('success');
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

  it('ends at once with conclusion merged when a human merged the PR, even with pending checks', () => {
    const { sb, work } = setup([{ out: checksJson(['build', 'pending']), code: 8 }]);
    writeFileSync(join(sb.root, 'checks', 'states'), 'MERGED\n');
    expect(waitCi(sb, work)).toEqual({
      conclusion: 'merged',
      failed: [],
      checks_url: `https://github.com/${FORK_REPO}/pull/77/checks`,
      attempt: 0,
    });
    expect(calls(sb).some(c => c.startsWith('gh pr checks'))).toBe(false);
    expect(calls(sb).some(c => c.startsWith('sleep'))).toBe(false);
  });

  it('ends with merged at the first poll after the merge, without waiting for the failed check set', () => {
    // A failed check during the wait must not lead to fix-ci on a merged PR.
    const { sb, work } = setup([
      { out: checksJson(['build', 'pending'], ['tests', 'fail']), code: 8 },
    ]);
    writeFileSync(join(sb.root, 'checks', 'states'), 'OPEN\nOPEN\nMERGED\n');
    const ci = waitCi(sb, work);
    expect(ci.conclusion).toBe('merged');
    expect(calls(sb).filter(c => c.startsWith('gh pr checks'))).toHaveLength(2);
  });

  it('ends with conclusion closed when a human closed the PR without merging', () => {
    const { sb, work } = setup([{ out: checksJson(['build', 'pending']), code: 8 }]);
    writeFileSync(join(sb.root, 'checks', 'states'), 'CLOSED\n');
    expect(waitCi(sb, work).conclusion).toBe('closed');
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
    const again = loopGroupOf('fix-ci').nodes.find(n => n.id === 'wait-ci-again') as {
      bash?: string;
    };
    const r = run(sb, render(again.bash ?? '', sb.artifacts), { cwd: work });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ conclusion: 'failure', attempt: 1 });
  });

  it('the loop body fails before waiting when the fix left a change for the engine to commit', () => {
    const { sb, work } = setup([{ out: checksJson(['build', 'fail']), code: 1 }]);
    writeFileSync(join(sb.sync, 'ci.json'), JSON.stringify({ conclusion: 'failure', attempt: 0 }));
    writeFileSync(join(work, 'f'), 'uncommitted fix\n');
    const again = loopGroupOf('fix-ci').nodes.find(n => n.id === 'wait-ci-again') as {
      bash?: string;
    };
    const r = run(sb, render(again.bash ?? '', sb.artifacts), { cwd: work });
    expect(r.status).toBe(1);
    expect(readFileSync(join(sb.sync, 'guard-failure.txt'), 'utf-8')).toContain(' M f');
    expect(calls(sb).some(c => c.startsWith('gh pr checks'))).toBe(false);
  });

  const failedWithLinks = JSON.stringify([
    {
      name: 'server',
      state: 'FAILURE',
      bucket: 'fail',
      link: 'https://github.com/r/actions/runs/111/job/1',
    },
    {
      name: 'app',
      state: 'FAILURE',
      bucket: 'fail',
      link: 'https://github.com/r/actions/runs/111/job/2',
    },
    {
      name: 'cli',
      state: 'FAILURE',
      bucket: 'fail',
      link: 'https://github.com/r/actions/runs/222/job/3',
    },
    {
      name: 'lint',
      state: 'SUCCESS',
      bucket: 'pass',
      link: 'https://github.com/r/actions/runs/333/job/4',
    },
  ]);

  function rerunCi(sb: Sandbox, work: string): Record<string, unknown> {
    writeFileSync(
      join(sb.sync, 'ci.json'),
      JSON.stringify({ conclusion: 'failure', failed: ['server'], checks_url: 'c', attempt: 0 })
    );
    const r = run(sb, render(bashOf('rerun-ci'), sb.artifacts), { cwd: work });
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout) as Record<string, unknown>;
  }

  it('rerun-ci re-runs the failed jobs of each failed run once, waits again, and fixes nothing after a pass', () => {
    const { sb, work } = setup([
      { out: failedWithLinks, code: 1 },
      { out: checksJson(['server', 'pending']), code: 8 },
      { out: checksJson(['server', 'pass'], ['lint', 'pass']), code: 0 },
    ]);
    expect(rerunCi(sb, work)).toEqual({
      conclusion: 'success',
      failed: [],
      checks_url: `https://github.com/${FORK_REPO}/pull/77/checks`,
      attempt: 0,
      rerun: true,
      fix: false,
    });
    expect(calls(sb).filter(c => c.startsWith('gh run rerun'))).toEqual([
      `gh run rerun 111 --failed --repo ${FORK_REPO}`,
      `gh run rerun 222 --failed --repo ${FORK_REPO}`,
    ]);
  });

  it('rerun-ci hands a CI that still fails after the re-run to the fix loop', () => {
    const { sb, work } = setup([
      { out: failedWithLinks, code: 1 },
      { out: checksJson(['server', 'pending']), code: 8 },
      { out: checksJson(['server', 'fail'], ['lint', 'pass']), code: 1 },
    ]);
    expect(rerunCi(sb, work)).toMatchObject({
      conclusion: 'failure',
      failed: ['server'],
      attempt: 0,
      rerun: true,
      fix: true,
    });
  });

  it('rerun-ci does not wait when no run can be re-run, and fixes the failed CI', () => {
    const { sb, work } = setup([{ out: failedWithLinks, code: 1 }]);
    sb.env.FAKE_RERUN_RESULT = 'refused';
    expect(rerunCi(sb, work)).toEqual({
      conclusion: 'failure',
      failed: ['server'],
      checks_url: 'c',
      attempt: 0,
      rerun: false,
      fix: true,
    });
    expect(calls(sb).filter(c => c.startsWith('gh pr checks'))).toHaveLength(1);
  });

  it('pr-open skips the fix and records the state when a human merged or closed the PR', () => {
    const prOpen = loopGroupOf('fix-ci').nodes.find(n => n.id === 'pr-open') as { bash?: string };
    for (const [state, open] of [
      ['OPEN', true],
      ['MERGED', false],
      ['CLOSED', false],
    ] as const) {
      const { sb, work } = setup([]);
      sb.env.FAKE_PR_STATE = state;
      writeFileSync(
        join(sb.sync, 'ci.json'),
        JSON.stringify({ conclusion: 'failure', failed: ['server'], checks_url: 'c', attempt: 0 })
      );
      const r = run(sb, render(prOpen.bash ?? '', sb.artifacts), { cwd: work });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ open });
      const ci = readJson<{ conclusion: string; failed: string[] }>(join(sb.sync, 'ci.json'));
      expect(ci.conclusion).toBe(open ? 'failure' : state.toLowerCase());
      expect(ci.failed).toEqual(open ? ['server'] : []);
    }
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
    expect(JSON.parse(check.stdout)).toEqual({ passed: true });
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

describe('merge-pr node (executable)', () => {
  /** A pushed sync branch with an open PR and the given last CI result. */
  function runMerge(
    conclusion: string,
    env: NodeJS.ProcessEnv = {}
  ): { sb: Sandbox; head: string; status: number | null; stdout: string; stderr: string } {
    const { sb, repos } = committedMerge();
    const sync = readJson<Record<string, unknown>>(join(sb.sync, 'sync.json'));
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({ ...sync, repo: FORK_REPO, issue: ISSUE })
    );
    writeFileSync(
      join(sb.sync, 'pr.json'),
      JSON.stringify({ pr_url: `https://github.com/${FORK_REPO}/pull/77`, number: 77 })
    );
    writeFileSync(
      join(sb.sync, 'ci.json'),
      JSON.stringify({
        conclusion,
        failed: conclusion === 'failure' ? ['e2e'] : [],
        checks_url: 'https://c',
        attempt: conclusion === 'failure' ? 2 : 0,
      })
    );
    const head = git(sb, repos.work, 'rev-parse', 'HEAD');
    const r = run(sb, render(bashOf('merge-pr'), sb.artifacts), { cwd: repos.work, env });
    return { sb, head, ...r };
  }

  it('merges a green PR with a merge commit at the pushed head and records the merge commit', () => {
    const r = runMerge('success');
    expect(r.status).toBe(0);
    expect(calls(r.sb)).toEqual([
      `gh pr merge 77 --repo ${FORK_REPO} --merge --match-head-commit ${r.head}`,
      `gh pr view 77 --repo ${FORK_REPO} --json state,mergeCommit`,
    ]);
    const out = { merged: true, merged_by: 'archon', merge_commit: 'd'.repeat(40) };
    expect(JSON.parse(r.stdout)).toEqual(out);
    expect(readJson(join(r.sb.sync, 'merge.json'))).toEqual(out);
  });

  it('does not merge a red PR and fails with the reason', () => {
    const r = runMerge('failure');
    expect(r.status).toBe(1);
    expect(calls(r.sb)).toEqual([]);
    expect(existsSync(join(r.sb.sync, 'merge.json'))).toBe(false);
    const reason = readFileSync(join(r.sb.sync, 'merge-problems.txt'), 'utf-8');
    expect(reason).toContain('is failure after 2 fix attempt(s); failed checks: e2e');
    expect(reason).toContain('The pull request is not merged.');
    expect(r.stderr).toContain('The pull request is not merged.');
  });

  it('does not merge when CI showed no checks or the PR was closed', () => {
    for (const conclusion of ['no_checks', 'closed']) {
      const r = runMerge(conclusion);
      expect(r.status).toBe(1);
      expect(calls(r.sb)).toEqual([]);
    }
  });

  it('fails when the PR is still not merged after the merge call and a few reads', () => {
    const { sb, repos } = committedMerge();
    const sync = readJson<Record<string, unknown>>(join(sb.sync, 'sync.json'));
    writeFileSync(join(sb.sync, 'sync.json'), JSON.stringify({ ...sync, repo: FORK_REPO }));
    writeFileSync(
      join(sb.sync, 'pr.json'),
      JSON.stringify({ pr_url: `https://github.com/${FORK_REPO}/pull/77`, number: 77 })
    );
    writeFileSync(join(sb.sync, 'ci.json'), JSON.stringify({ conclusion: 'success', attempt: 0 }));
    // A merge call that reports success but changes nothing.
    const bin2 = join(sb.root, 'bin2');
    mkdirSync(bin2);
    writeExecutable(
      join(bin2, 'gh'),
      '#!/bin/bash\nprintf "gh %s\\n" "$*" >> "$FAKE_LOG"\n' +
        'case "$1 $2" in "pr view") echo \'{"state":"OPEN","mergeCommit":null}\' ;; esac\nexit 0\n'
    );
    const r = run(sb, render(bashOf('merge-pr'), sb.artifacts), {
      cwd: repos.work,
      env: { PATH: `${bin2}:${sb.env.PATH ?? ''}` },
    });
    expect(r.status).toBe(1);
    expect(calls(sb).filter(c => c.startsWith('gh pr view'))).toHaveLength(4);
    expect(calls(sb).filter(c => c.startsWith('sleep'))).toHaveLength(4);
    expect(readFileSync(join(sb.sync, 'merge-problems.txt'), 'utf-8')).toContain(
      'is OPEN after gh pr merge'
    );
  });

  it('fails when GitHub refuses the merge, for example after the branch moved', () => {
    const r = runMerge('success', { FAKE_MERGE_RESULT: 'refuse' });
    expect(r.status).toBe(1);
    expect(readFileSync(join(r.sb.sync, 'merge-problems.txt'), 'utf-8')).toContain(
      'gh pr merge failed'
    );
    expect(existsSync(join(r.sb.sync, 'merge.json'))).toBe(false);
  });

  it('merges nothing when a human already merged the PR', () => {
    const r = runMerge('merged');
    expect(r.status).toBe(0);
    expect(calls(r.sb)).toEqual([]);
    expect(JSON.parse(r.stdout)).toEqual({ merged: true, merged_by: 'human' });
  });
});

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
      summary: `PR: https://github.com/${FORK_REPO}/pull/77`,
    });
    expect(calls(sb)).toEqual([]);
  });

  it('reports merged by Archon with the PR and the merge commit after merge-pr merged it', () => {
    const sb = makeSandbox();
    seedPr(sb, { conclusion: 'success', failed: [], checks_url: 'https://c', attempt: 0 });
    writeFileSync(
      join(sb.sync, 'merge.json'),
      JSON.stringify({ merged: true, merged_by: 'archon', merge_commit: SHA_B })
    );
    expect(runFinalize(sb)).toEqual({
      outcome: 'merged',
      pr_url: `https://github.com/${FORK_REPO}/pull/77`,
      ci: { conclusion: 'success', failed: [], checks_url: 'https://c' },
      issue: ISSUE,
      upstream_sha: SHA_A,
      files: ['src/grid.ts'],
      notified: true,
      summary: `PR merged by Archon: https://github.com/${FORK_REPO}/pull/77 (merge commit ${SHA_B})`,
      merged_by: 'archon',
      merge_commit: SHA_B,
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
    expect(bodies).toContain('Archon did not merge it.');
  });

  it('reports merged, with no comment, when a human merged the PR during the CI wait', () => {
    const sb = makeSandbox();
    seedPr(sb, { conclusion: 'merged', failed: [], checks_url: 'https://c', attempt: 0 });
    const out = runFinalize(sb);
    expect(out).toMatchObject({
      outcome: 'merged',
      pr_url: `https://github.com/${FORK_REPO}/pull/77`,
      ci: { conclusion: 'merged', failed: [], checks_url: 'https://c' },
      notified: true,
    });
    expect(calls(sb)).toEqual([]);
  });

  it('reports pr_closed, with no comment, when a human closed the PR', () => {
    const sb = makeSandbox();
    seedPr(sb, { conclusion: 'closed', failed: [], checks_url: 'https://c', attempt: 0 });
    expect(runFinalize(sb).outcome).toBe('pr_closed');
    expect(calls(sb)).toEqual([]);
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

  it('names check as the stage and quotes its reason when nothing was pushed', () => {
    const sb = makeSandbox();
    writeFileSync(join(sb.sync, 'issue.json'), JSON.stringify(ISSUE_ID));
    writeFileSync(join(sb.sync, 'sync.json'), JSON.stringify(SYNC));
    // No resolution.md: a resolver that gave up may write none.
    writeFileSync(
      join(sb.sync, 'check-failure.txt'),
      'The branch does not pass the final checks:\n- local checks fail: lint\n'
    );
    const out = runFinalize(sb);
    expect(out.stage).toBe('check');
    expect(out.reason).toBe(
      'The branch does not pass the final checks:\n- local checks fail: lint'
    );
    expect(calls(sb).filter(c => c.startsWith('gh issue comment'))).toHaveLength(1);
  });

  it('names the stage of a failure after check', () => {
    const sb = makeSandbox();
    writeFileSync(join(sb.sync, 'issue.json'), JSON.stringify(ISSUE_ID));
    writeFileSync(join(sb.sync, 'sync.json'), JSON.stringify(SYNC));
    writeFileSync(join(sb.sync, 'resolution.md'), 'x');
    writeFileSync(join(sb.sync, 'pr-problems.txt'), 'the base is not main\n');
    const out = runFinalize(sb);
    expect(out.stage).toBe('publish, create-pr or verify-pr (pr.json)');
    expect(out.reason).toBe('the base is not main');
  });

  it('calls nothing when the issue was never confirmed', () => {
    const sb = makeSandbox();
    expect(runFinalize(sb)).toEqual({ outcome: 'failed', issue: null });
    expect(calls(sb)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cleanup of build outputs at the end of a run and for earlier runs
// ---------------------------------------------------------------------------

describe('cleanup script (executable)', () => {
  interface RunTree {
    source: string;
    runsRoot: string;
  }

  /** A source checkout that ignores build-output folders. */
  function sourceRepo(sb: Sandbox): RunTree {
    const source = join(sb.root, 'source');
    mkdirSync(source, { recursive: true });
    git(sb, source, 'init', '-q', '-b', 'main');
    writeFileSync(join(source, '.gitignore'), 'node_modules/\ndist/\n*.log\n');
    writeFileSync(join(source, 'f'), 'x\n');
    git(sb, source, 'add', '.gitignore', 'f');
    git(sb, source, 'commit', '-q', '-m', 'c');
    return { source, runsRoot: join(sb.artifacts, 'state', 'sync-runs') };
  }

  /** A linked worktree with build outputs, recorded as the run `id`. */
  function recordedRun(sb: Sandbox, tree: RunTree, id: string): string {
    const wt = join(sb.root, `wt-${id}`);
    git(sb, tree.source, 'worktree', 'add', '-q', '-b', `archon/thread-${id}`, wt);
    mkdirSync(join(wt, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(wt, 'node_modules', 'pkg', 'index.js'), 'x\n');
    mkdirSync(join(wt, 'packages', 'app', 'dist'), { recursive: true });
    writeFileSync(join(wt, 'packages', 'app', 'dist', 'main.js'), 'x\n');
    const record = join(tree.runsRoot, id);
    mkdirSync(join(record, 'cargo-target'), { recursive: true });
    writeFileSync(join(record, 'worktree'), `${realpathSync(wt)}\n`);
    return realpathSync(wt);
  }

  function answer(sb: Sandbox, id: string, code: number, status?: string): void {
    writeFileSync(join(sb.env.FAKE_CURL_DIR as string, `${id}.code`), String(code));
    if (status) {
      writeFileSync(
        join(sb.env.FAKE_CURL_DIR as string, `${id}.json`),
        JSON.stringify({ run: { id, status } })
      );
    }
  }

  function seedSync(sb: Sandbox, tree: RunTree, ownId: string): void {
    installSyncScripts(sb);
    writeFileSync(
      join(sb.sync, 'sync.json'),
      JSON.stringify({ runs_root: tree.runsRoot, run_dir: join(tree.runsRoot, ownId) })
    );
  }

  function cleanup(sb: Sandbox, mode: string, cwd?: string): ReturnType<typeof run> {
    return run(sb, `bash "${join(sb.sync, 'cleanup.sh')}" ${mode}`, cwd ? { cwd } : {});
  }

  it('run mode removes the ignored build outputs and keeps sources and the record', () => {
    const sb = makeSandbox();
    const tree = sourceRepo(sb);
    const wt = recordedRun(sb, tree, 'own');
    writeFileSync(join(wt, 'notes.txt'), 'untracked, not ignored\n');
    seedSync(sb, tree, 'own');
    expect(cleanup(sb, 'run', wt).status).toBe(0);
    expect(existsSync(join(wt, 'node_modules'))).toBe(false);
    expect(existsSync(join(wt, 'packages', 'app', 'dist'))).toBe(false);
    expect(existsSync(join(wt, 'f'))).toBe(true);
    expect(existsSync(join(wt, 'notes.txt'))).toBe(true);
    expect(existsSync(join(tree.runsRoot, 'own', 'cargo-target'))).toBe(false);
    expect(existsSync(join(tree.runsRoot, 'own', 'worktree'))).toBe(true);
  });

  it('sweep removes the worktree and record of a completed, cancelled or unknown run', () => {
    const sb = makeSandbox();
    const tree = sourceRepo(sb);
    const own = recordedRun(sb, tree, 'own');
    const done = recordedRun(sb, tree, 'done');
    const cancelled = recordedRun(sb, tree, 'cancelled');
    const gone = recordedRun(sb, tree, 'gone');
    answer(sb, 'done', 200, 'completed');
    answer(sb, 'cancelled', 200, 'cancelled');
    answer(sb, 'gone', 404);
    seedSync(sb, tree, 'own');
    expect(cleanup(sb, 'sweep', own).status).toBe(0);
    for (const [id, wt] of [
      ['done', done],
      ['cancelled', cancelled],
      ['gone', gone],
    ] as const) {
      expect(existsSync(wt)).toBe(false);
      expect(existsSync(join(tree.runsRoot, id))).toBe(false);
    }
    // The current run is never touched; the branches stay in the repository.
    expect(existsSync(join(own, 'node_modules'))).toBe(true);
    expect(existsSync(join(tree.runsRoot, 'own', 'cargo-target'))).toBe(true);
    expect(git(sb, tree.source, 'branch', '--list', 'archon/thread-done')).toContain(
      'archon/thread-done'
    );
    expect(calls(sb)).toContain(
      `curl -sS -m 10 -o ${join(sb.sync, 'cleanup-run.json')} -w %{http_code} ` +
        'http://127.0.0.1:3090/api/workflows/runs/done'
    );
    expect(existsSync(join(sb.sync, 'cleanup-run.json'))).toBe(false);
  });

  it('sweep keeps the worktree of a failed run for a retry and removes only its outputs', () => {
    const sb = makeSandbox();
    const tree = sourceRepo(sb);
    const own = recordedRun(sb, tree, 'own');
    const failed = recordedRun(sb, tree, 'failed');
    answer(sb, 'failed', 200, 'failed');
    seedSync(sb, tree, 'own');
    expect(cleanup(sb, 'sweep', own).status).toBe(0);
    expect(existsSync(join(failed, 'f'))).toBe(true);
    expect(existsSync(join(failed, 'node_modules'))).toBe(false);
    expect(existsSync(join(tree.runsRoot, 'failed'))).toBe(false);
  });

  it('sweep keeps every file of an active run and of a run whose state cannot be read', () => {
    const sb = makeSandbox();
    const tree = sourceRepo(sb);
    const own = recordedRun(sb, tree, 'own');
    const paused = recordedRun(sb, tree, 'paused');
    const unreadable = recordedRun(sb, tree, 'unreadable');
    answer(sb, 'paused', 200, 'paused');
    seedSync(sb, tree, 'own');
    const r = cleanup(sb, 'sweep', own);
    expect(r.status).toBe(0);
    for (const [id, wt] of [
      ['paused', paused],
      ['unreadable', unreadable],
    ] as const) {
      expect(existsSync(join(wt, 'node_modules'))).toBe(true);
      expect(existsSync(join(tree.runsRoot, id, 'worktree'))).toBe(true);
    }
    expect(r.stderr).toContain("kept the run paused (status 'paused')");
    expect(r.stderr).toContain("kept the run unreadable (status 'unknown')");
  });

  it('sweep keeps a worktree that is not clean and never removes the main checkout', () => {
    const sb = makeSandbox();
    const tree = sourceRepo(sb);
    const own = recordedRun(sb, tree, 'own');
    const dirty = recordedRun(sb, tree, 'dirty');
    writeFileSync(join(dirty, 'f'), 'changed\n');
    mkdirSync(join(tree.runsRoot, 'main'), { recursive: true });
    writeFileSync(join(tree.runsRoot, 'main', 'worktree'), `${realpathSync(tree.source)}\n`);
    answer(sb, 'dirty', 200, 'completed');
    answer(sb, 'main', 200, 'completed');
    seedSync(sb, tree, 'own');
    expect(cleanup(sb, 'sweep', own).status).toBe(0);
    expect(readFileSync(join(dirty, 'f'), 'utf-8')).toBe('changed\n');
    expect(existsSync(join(tree.source, 'f'))).toBe(true);
  });

  function watch(sb: Sandbox, polls: number): ReturnType<typeof run> {
    return run(sb, `bash "${join(sb.sync, 'cleanup.sh')}" watch`, {
      env: { CLEANUP_WATCH_POLLS: String(polls) },
    });
  }

  it('watch removes everything of its run once it reads cancelled or completed twice', () => {
    for (const status of ['cancelled', 'completed']) {
      const sb = makeSandbox();
      const tree = sourceRepo(sb);
      const wt = recordedRun(sb, tree, 'own');
      answer(sb, 'own', 200, status);
      seedSync(sb, tree, 'own');
      const r = watch(sb, 10);
      expect(r.status).toBe(0);
      expect(existsSync(wt)).toBe(false);
      expect(existsSync(join(tree.runsRoot, 'own'))).toBe(false);
      expect(git(sb, tree.source, 'branch', '--list', 'archon/thread-own')).toContain(
        'archon/thread-own'
      );
      expect(r.stderr).toContain(`the run own is ${status}`);
      // One poll to read the state, one to confirm it, then it stops.
      expect(calls(sb).filter(c => c.startsWith('curl'))).toHaveLength(2);
      expect(calls(sb).filter(c => c.startsWith('sleep'))).toEqual(['sleep 60', 'sleep 60']);
    }
  });

  it('watch removes the outputs of a failed run and keeps its worktree and record', () => {
    const sb = makeSandbox();
    const tree = sourceRepo(sb);
    const wt = recordedRun(sb, tree, 'own');
    answer(sb, 'own', 200, 'failed');
    seedSync(sb, tree, 'own');
    const r = watch(sb, 4);
    expect(r.status).toBe(0);
    expect(existsSync(join(wt, 'f'))).toBe(true);
    expect(existsSync(join(wt, 'node_modules'))).toBe(false);
    expect(existsSync(join(tree.runsRoot, 'own', 'cargo-target'))).toBe(false);
    expect(existsSync(join(tree.runsRoot, 'own', 'worktree'))).toBe(true);
    // A failed run can be resumed, so the watcher polls on until its last poll.
    expect(calls(sb).filter(c => c.startsWith('curl'))).toHaveLength(4);
  });

  it('watch keeps every file of a paused run and of a run whose state cannot be read', () => {
    for (const code of [200, 0]) {
      const sb = makeSandbox();
      const tree = sourceRepo(sb);
      const wt = recordedRun(sb, tree, 'own');
      if (code === 200) answer(sb, 'own', 200, 'paused');
      seedSync(sb, tree, 'own');
      expect(watch(sb, 3).status).toBe(0);
      expect(existsSync(join(wt, 'node_modules'))).toBe(true);
      expect(existsSync(join(tree.runsRoot, 'own', 'cargo-target'))).toBe(true);
      expect(existsSync(join(tree.runsRoot, 'own', 'worktree'))).toBe(true);
    }
  });

  it('watch stops when a sweep already removed the record of its run', () => {
    const sb = makeSandbox();
    const tree = sourceRepo(sb);
    const wt = recordedRun(sb, tree, 'own');
    answer(sb, 'own', 200, 'running');
    seedSync(sb, tree, 'own');
    // This sleep stands in for a sweep that removes the record between two polls.
    const bin2 = join(sb.root, 'bin2');
    mkdirSync(bin2);
    writeExecutable(
      join(bin2, 'sleep'),
      `#!/bin/bash\nprintf 'sleep %s\\n' "$*" >> "$FAKE_LOG"\nrm -rf "${join(tree.runsRoot, 'own')}"\n`
    );
    const r = run(sb, `bash "${join(sb.sync, 'cleanup.sh')}" watch`, {
      env: { CLEANUP_WATCH_POLLS: '100', PATH: `${bin2}:${sb.env.PATH ?? ''}` },
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(wt, 'node_modules'))).toBe(true);
    expect(calls(sb).filter(c => c.startsWith('curl'))).toEqual([]);
  });

  it('does nothing and exits 0 without a run record in sync.json', () => {
    const sb = makeSandbox();
    installSyncScripts(sb);
    writeFileSync(join(sb.sync, 'sync.json'), JSON.stringify({ repo: FORK_REPO }));
    expect(cleanup(sb, 'sweep').status).toBe(0);
    expect(calls(sb).filter(c => c.startsWith('curl'))).toEqual([]);
  });

  it('finalize removes the build outputs of its run on success and on failure', () => {
    for (const withPr of [true, false]) {
      const sb = makeSandbox();
      const tree = sourceRepo(sb);
      const wt = recordedRun(sb, tree, 'own');
      installSyncScripts(sb);
      writeFileSync(
        join(sb.sync, 'issue.json'),
        JSON.stringify({ repo: FORK_REPO, issue: ISSUE, issue_url: 'u', run_url: 'r' })
      );
      writeFileSync(
        join(sb.sync, 'sync.json'),
        JSON.stringify({
          repo: FORK_REPO,
          issue: ISSUE,
          upstream_sha: SHA_A,
          files: [],
          runs_root: tree.runsRoot,
          run_dir: join(tree.runsRoot, 'own'),
        })
      );
      if (withPr) {
        writeFileSync(
          join(sb.sync, 'pr.json'),
          JSON.stringify({ pr_url: `https://github.com/${FORK_REPO}/pull/77`, number: 77 })
        );
        writeFileSync(
          join(sb.sync, 'ci.json'),
          JSON.stringify({ conclusion: 'success', failed: [], checks_url: 'c', attempt: 0 })
        );
      }
      const r = run(sb, render(bashOf('finalize'), sb.artifacts), { cwd: wt });
      expect(r.status).toBe(0);
      expect((JSON.parse(r.stdout) as { outcome: string }).outcome).toBe(
        withPr ? 'pr_ready' : 'failed'
      );
      expect(existsSync(join(wt, 'node_modules'))).toBe(false);
      expect(existsSync(join(tree.runsRoot, 'own', 'cargo-target'))).toBe(false);
      expect(existsSync(join(tree.runsRoot, 'own', 'worktree'))).toBe(true);
    }
  });
});
