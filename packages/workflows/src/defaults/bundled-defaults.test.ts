import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
  mkdtempSync,
  mkdirSync,
  utimesSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isBinaryBuild,
  BUNDLED_COMMANDS,
  BUNDLED_SCRIPTS,
  BUNDLED_WORKFLOWS,
  BUNDLED_WORKFLOW_OWNERS,
} from './bundled-defaults';
import {
  formatPackagedResourceReference,
  parsePackagedResourceReference,
} from '../packaged-workflow';
import { substituteNodeOutputRefs } from '../dag-executor';
import type { NodeOutput } from '../schemas';

// Resolve the on-disk defaults directories relative to this test file so the
// tests work regardless of cwd. From packages/workflows/src/defaults go up
// four levels to the repo root, then into .archon/.
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const COMMANDS_DIR = join(REPO_ROOT, '.archon/commands/defaults');
const WORKFLOWS_DIR = join(REPO_ROOT, '.archon/workflows/defaults');

function findPackagedScriptPath(scriptDir: string, name: string, extension: string): string {
  const filename = `${name}${extension}`;
  const direct = join(scriptDir, filename);
  if (existsSync(direct)) return direct;
  const matches = readdirSync(scriptDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(scriptDir, entry.name, filename))
    .filter(path => existsSync(path));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one packaged script named ${filename} under ${scriptDir}, found ${matches.length}`
    );
  }
  return matches[0];
}

describe('bundled-defaults', () => {
  describe('isBinaryBuild', () => {
    it('should return false in dev/test mode', () => {
      // `isBinaryBuild()` reads the build-time constant `BUNDLED_IS_BINARY` from
      // `@archon/paths`. In dev/test mode it is `false`. It is only rewritten to
      // `true` by `scripts/build-binaries.sh` before `bun build --compile`.
      // Coverage of the `true` branch is via local binary smoke testing (see #979).
      expect(isBinaryBuild()).toBe(false);
    });
  });

  describe('bundle completeness', () => {
    // These assertions are the canary for bundle drift: if someone adds a
    // default file without regenerating bundled-defaults.generated.ts, the
    // bundle would be missing in compiled binaries (see #979 context). The
    // generator is `scripts/generate-bundled-defaults.ts`, and
    // `bun run check:bundled` verifies the generated file is up to date.

    it('BUNDLED_COMMANDS contains every .md file in .archon/commands/defaults/', () => {
      const onDisk = readdirSync(COMMANDS_DIR)
        .filter(f => f.endsWith('.md'))
        .map(f => f.slice(0, -'.md'.length))
        .sort();
      expect(
        Object.keys(BUNDLED_COMMANDS)
          .filter(name => parsePackagedResourceReference(name) === null)
          .sort()
      ).toEqual(onDisk);
    });

    it('BUNDLED_WORKFLOWS contains every .yaml/.yml file in .archon/workflows/defaults/', () => {
      const onDisk = readdirSync(WORKFLOWS_DIR)
        .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map(f => f.replace(/\.ya?ml$/, ''))
        .sort();
      expect(
        Object.keys(BUNDLED_WORKFLOWS)
          .filter(name => BUNDLED_WORKFLOW_OWNERS[name] === undefined)
          .sort()
      ).toEqual(onDisk);
    });

    it('bundled content matches on-disk file content (defense against generator corruption)', () => {
      // Bundled content is LF-normalized by the generator so it stays identical
      // regardless of the checkout's line-ending policy. Match that here.
      const readLF = (path: string): string => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

      for (const [name, content] of Object.entries(BUNDLED_COMMANDS)) {
        const diskContent = readLF(join(COMMANDS_DIR, `${name}.md`));
        expect(content).toBe(diskContent);
      }
      for (const [name, content] of Object.entries(BUNDLED_WORKFLOWS)) {
        // Workflows may be .yaml or .yml - prefer .yaml, fall back.
        let diskContent: string;
        try {
          diskContent = readLF(join(WORKFLOWS_DIR, `${name}.yaml`));
        } catch {
          diskContent = readLF(join(WORKFLOWS_DIR, `${name}.yml`));
        }
        expect(content).toBe(diskContent);
      }
    });

    it('packaged bundle metadata is internally consistent', () => {
      for (const [workflow, owner] of Object.entries(BUNDLED_WORKFLOW_OWNERS)) {
        expect(BUNDLED_WORKFLOWS[workflow]).toBeDefined();
        expect(owner.pack.length).toBeGreaterThan(0);
        expect(owner.workflow.length).toBeGreaterThan(0);
        const workflowDir = join(REPO_ROOT, '.archon', 'workflows', owner.pack, owner.workflow);
        const yaml = readdirSync(workflowDir).find(entry => /\.ya?ml$/.test(entry));
        expect(yaml).toBeDefined();
        expect(BUNDLED_WORKFLOWS[workflow]).toBe(
          readFileSync(join(workflowDir, yaml!), 'utf-8').replace(/\r\n/g, '\n')
        );

        const commandDir = join(workflowDir, 'commands');
        if (existsSync(commandDir)) {
          for (const entry of readdirSync(commandDir).filter(entry => entry.endsWith('.md'))) {
            const localName = entry.slice(0, -'.md'.length);
            const key = formatPackagedResourceReference({ source: 'bundled', ...owner }, localName);
            expect(BUNDLED_COMMANDS[key]).toBe(
              readFileSync(join(commandDir, entry), 'utf-8').replace(/\r\n/g, '\n')
            );
          }
        }
      }
      for (const [name, script] of Object.entries(BUNDLED_SCRIPTS)) {
        expect(name.startsWith('__archon_pack__bundled:')).toBe(true);
        expect(['.ts', '.js', '.py']).toContain(script.extension);
        expect(['bun', 'uv']).toContain(script.runtime);
        expect(script.content.length).toBeGreaterThan(0);
        const packaged = parsePackagedResourceReference(name);
        expect(packaged).not.toBeNull();
        const scriptDir = join(
          REPO_ROOT,
          '.archon',
          'workflows',
          packaged!.owner.pack,
          packaged!.owner.workflow,
          'scripts'
        );
        const diskPath = findPackagedScriptPath(scriptDir, packaged!.name, script.extension);
        expect(script.content).toBe(readFileSync(diskPath, 'utf-8').replace(/\r\n/g, '\n'));
      }
    });
  });

  describe('BUNDLED_COMMANDS', () => {
    it('every command has meaningful content (>50 chars)', () => {
      for (const content of Object.values(BUNDLED_COMMANDS)) {
        expect(content.length).toBeGreaterThan(50);
      }
    });

    it('archon-pr-review-scope should read .pr-number before other discovery', () => {
      const content = BUNDLED_COMMANDS['archon-pr-review-scope'];
      expect(content).toContain('$ARTIFACTS_DIR/.pr-number');
      expect(content).toContain('PR_NUMBER=$(cat $ARTIFACTS_DIR/.pr-number');
    });

    it('archon-create-pr should write .pr-number to artifacts', () => {
      const content = BUNDLED_COMMANDS['archon-create-pr'];
      expect(content).toContain('echo "$PR_NUMBER" > "$ARTIFACTS_DIR/.pr-number"');
    });

    it('archon-create-pr should always use BASE_BRANCH for PR base', () => {
      const content = BUNDLED_COMMANDS['archon-create-pr'];
      expect(content).toContain('argument-hint: (none - uses $BASE_BRANCH from config or repo)');
      expect(content).toContain('**Base branch**: $BASE_BRANCH');
      expect(content).toContain('Always use `$BASE_BRANCH` for `--base`');
      expect(content).toContain('--base "$BASE_BRANCH"');
      expect(content).not.toContain('Base branch override');
      expect(content).not.toContain('base branch was provided as argument');
      expect(content).not.toContain('**Default base branch**');
    });

    it('archon-create-pr should target the configured PR remote repository', () => {
      const content = BUNDLED_COMMANDS['archon-create-pr'];
      expect(content).toContain('**PR target remote**: $PR_REMOTE');
      expect(content).toContain('git remote get-url "$PR_REMOTE"');
      expect(content).toContain('--repo "$PR_REPO"');
      expect(content).toContain('--head "$PR_HEAD"');
    });

    it('archon-create-pr should resolve a related issue and put Closes in the PR body', () => {
      const content = BUNDLED_COMMANDS['archon-create-pr'];
      expect(content).toContain('if .pull_request then empty else .number end');
      expect(content).toContain('^[0-9]+-[0-9]+-');
      expect(content).toContain('--search "$ARGUMENTS"');
      expect(content).toContain('Closes #${ISSUE_NUM}');
      expect(content).toContain('gh pr edit "$PR_NUMBER" --repo "$PR_REPO" --body-file');
      expect(content).toContain('repository default branch');
      expect(content).not.toContain('--fill');
    });

    it('archon-create-pr source 1b should search open issues by full $ARGUMENTS text via --jq', () => {
      const content = BUNDLED_COMMANDS['archon-create-pr'];
      // Must search open issues using the full $ARGUMENTS, not just parse for #N
      expect(content).toContain('--search "$ARGUMENTS"');
      // Uses gh --jq (gojq), not python3
      expect(content).toContain('--jq');
      expect(content).toContain('env.ARGS_TEXT');
      // No python3 command invocation (mentions in comments are fine)
      expect(content).not.toMatch(/python3\s+-c/);
      // Exact title match wins immediately
      expect(content).toMatch(/exact.*title|title.*exact/i);
      // Unique containment fallback via gojq length check
      expect(content).toContain('$partial | length');
      // $ARGUMENTS passed via env, not string interpolation
      expect(content).toContain('ARGS_TEXT="$ARGUMENTS"');
    });

    it('archon-create-pr should scan artifacts for tracker references', () => {
      const content = BUNDLED_COMMANDS['archon-create-pr'];
      expect(content).toContain('[Gg]it[Hh]ub[[:space:]]+issue[[:space:]]+[0-9]+');
      expect(content).toMatch(/Source 4[\s\S]*?ARTIFACTS_DIR/);
    });

    it('archon-finalize-pr should target the configured PR remote repository', () => {
      const content = BUNDLED_COMMANDS['archon-finalize-pr'];
      expect(content).toContain('**PR target remote**: $PR_REMOTE');
      expect(content).toContain('git remote get-url "$PR_REMOTE"');
      expect(content).toContain('gh pr list --repo "$PR_REPO" --head "$PR_HEAD"');
      expect(content).toContain('gh pr edit {pr-number} --repo "$PR_REPO"');
      expect(content).toContain('gh pr ready {pr-number} --repo "$PR_REPO"');
    });

    it('bundled PR creation defaults should not rely on implicit gh repo inference', () => {
      const contents = [
        ...Object.values(BUNDLED_COMMANDS),
        ...Object.values(BUNDLED_WORKFLOWS),
      ].join('\n');
      expect(contents).not.toContain('gh pr create --base $BASE_BRANCH');
      expect(contents).not.toContain('gh pr create --base "$BASE_BRANCH"');
      expect(contents).not.toContain('gh pr create --draft --base $BASE_BRANCH');
      expect(contents).not.toContain('gh pr create --draft --base "$BASE_BRANCH"');
      expect(contents).not.toContain('gh pr create --fill --base $BASE_BRANCH');
      expect(contents).not.toContain('gh pr create --fill --base "$BASE_BRANCH"');
    });
  });

  describe('candidate_issue_num_from_branch', () => {
    function candidateFromBranch(branch: string): string {
      const content = BUNDLED_COMMANDS['archon-create-pr'];
      const start = content.indexOf('# BEGIN candidate_issue_num_from_branch');
      const end = content.indexOf('# END candidate_issue_num_from_branch');
      if (start < 0 || end < 0 || end <= start) {
        throw new Error('candidate_issue_num_from_branch markers missing');
      }
      const fn = content.slice(start, end);
      const result = spawnSync(
        'bash',
        ['-c', `${fn}\ncandidate_issue_num_from_branch "$1"`, '_', branch],
        { encoding: 'utf8' }
      );
      if (result.status !== 0) {
        throw new Error(result.stderr || `bash exited ${result.status}`);
      }
      return result.stdout;
    }

    it('does not treat a 3-1 story key as issue 1', () => {
      expect(candidateFromBranch('3-1-record-adapter-readiness-and-refuse-unsupported-work')).toBe(
        ''
      );
    });

    it('reads issue-112 from the branch', () => {
      expect(candidateFromBranch('issue-112')).toBe('112');
    });

    it('reads fix/112-slug from the branch', () => {
      expect(candidateFromBranch('fix/112-slug')).toBe('112');
    });

    it('does not extract issue numbers from opaque thread branch names', () => {
      expect(candidateFromBranch('archon/thread-0d443474')).toBe('');
    });
  });

  describe('source 1b $ARGUMENTS title search (executable)', () => {
    // Extract the --jq filter from source 1b and run it against fixture data
    // via jq (same gojq syntax). This tests the actual matching logic without
    // needing a real GitHub API or python3.
    function runTitleMatch(
      argsText: string,
      issues: Array<{ number: number; title: string }>
    ): string {
      const content = BUNDLED_COMMANDS['archon-create-pr'];
      // Find the source 1b --jq specifically, not the issue_num_if_issue one
      const source1bMarker = '# --- Source 1b:';
      const source1bStart = content.indexOf(source1bMarker);
      if (source1bStart < 0) throw new Error('Source 1b marker missing');
      const jqMarker = "--jq '";
      const jqStart = content.indexOf(jqMarker, source1bStart);
      if (jqStart < 0) throw new Error('--jq marker missing in source 1b');
      const filterStart = jqStart + jqMarker.length;
      const filterEnd = content.indexOf("' 2>/dev/null)", filterStart);
      if (filterEnd < 0) throw new Error('--jq filter end marker missing');
      const jqFilter = content.slice(filterStart, filterEnd).trim();

      const jsonIssues = JSON.stringify(issues);
      // Write filter to a temp file to avoid shell quoting issues with multiline gojq.
      // jq reads JSON from stdin and filter from the file via -f.
      const tmpFilter = `/tmp/jq-filter-${process.pid}.jq`;
      writeFileSync(tmpFilter, jqFilter);
      try {
        const result = spawnSync(
          'bash',
          [
            '-c',
            `printf '%s' "$1" | ARGS_TEXT="$2" jq -r -f "$3"`,
            '_',
            jsonIssues,
            argsText,
            tmpFilter,
          ],
          { encoding: 'utf8', timeout: 10_000 }
        );
        if (result.status !== 0) {
          throw new Error(`jq filter failed (exit ${result.status}): ${result.stderr}`);
        }
        return result.stdout.trim();
      } finally {
        unlinkSync(tmpFilter);
      }
    }

    it('resolves exact title match for speckit story message', () => {
      const args =
        '[RM-02][Epic 3] 3-6-implement-the-characterized-external-control-paths: Implement the characterized external control paths';
      const issues = [
        { number: 119, title: args },
        {
          number: 120,
          title: '[RM-02][Epic 3] 3-8-list-native-sessions-when-the-matrix-allows-it',
        },
      ];
      expect(runTitleMatch(args, issues)).toBe('119');
    });

    it('resolves unique containment when $ARGUMENTS is a substring of the title', () => {
      const args = 'implement the characterized external control paths';
      const issues = [
        {
          number: 119,
          title:
            '[RM-02][Epic 3] 3-6-implement-the-characterized-external-control-paths: Implement the characterized external control paths',
        },
      ];
      expect(runTitleMatch(args, issues)).toBe('119');
    });

    it('returns empty when multiple issues partially match (ambiguity)', () => {
      const args = 'implement';
      const issues = [
        { number: 119, title: 'Implement the characterized external control paths' },
        { number: 120, title: 'Implement native session listing' },
      ];
      expect(runTitleMatch(args, issues)).toBe('');
    });

    it('returns empty when no issues match', () => {
      const args = 'completely unrelated feature request';
      const issues = [
        {
          number: 119,
          title: '[RM-02][Epic 3] 3-6-implement-the-characterized-external-control-paths',
        },
      ];
      expect(runTitleMatch(args, issues)).toBe('');
    });
  });

  describe('BUNDLED_WORKFLOWS', () => {
    it('every workflow has meaningful content (>50 chars)', () => {
      for (const content of Object.values(BUNDLED_WORKFLOWS)) {
        expect(content.length).toBeGreaterThan(50);
      }
    });

    it('archon-workflow-builder should have validate-before-save node ordering and key constraints', () => {
      const content = BUNDLED_WORKFLOWS['archon-workflow-builder'];
      expect(content).toContain('id: validate-yaml');
      expect(content).toContain('depends_on: [validate-yaml]');
      expect(content).toContain('denied_tools: [Edit, Bash]');
      expect(content).toContain('output_format:');
      expect(content).toContain('workflow_name');
    });

    it('archon-adversarial-dev init-workspace should avoid non-portable sed -i', () => {
      const content = BUNDLED_WORKFLOWS['archon-adversarial-dev'];
      expect(content).toContain('STATE_TMP="$ARTIFACTS/state.json.tmp"');
      expect(content).toContain(
        'sed "s/SPRINT_COUNT_PLACEHOLDER/$SPRINT_COUNT/" "$ARTIFACTS/state.json" > "$STATE_TMP"'
      );
      expect(content).not.toContain('sed -i "s/SPRINT_COUNT_PLACEHOLDER/$SPRINT_COUNT/"');
    });

    it('ak-implement verifies UI plans against their design artifacts', () => {
      const workflow = Bun.YAML.parse(BUNDLED_WORKFLOWS['ak-implement']) as {
        nodes: Array<{
          id: string;
          prompt?: string;
          depends_on?: string[];
          when?: string;
          bash?: string;
          output_format?: { properties?: { report?: { type?: string } } };
        }>;
      };
      const review = workflow.nodes.find(node => node.id === 'verify-and-fix-plan');
      const prompt = review?.prompt;
      expect(prompt).toContain('mockups, wireframes, prototypes, or other design artifacts');
      expect(prompt).toContain('whether it matches every applicable design artifact');
      expect(prompt).toContain(
        "resolve conflicts according to the repository's documented design authority"
      );
      expect(prompt).toContain(
        'do not guess; record the conflict in the plan and list it as a blocker'
      );
      expect(prompt).toContain(
        'add visual acceptance criteria for the required states and viewports'
      );
      expect(review?.output_format?.properties?.report?.type).toBe('string');
      expect(review?.when).toBeUndefined();

      expect(workflow.nodes.some(node => node.id === 'verified-plan-ready')).toBe(false);
      expect(workflow.nodes.some(node => node.id === 'verified-plan-blocked')).toBe(false);

      const build = workflow.nodes.find(node => node.id === 'build-ralph-prd');
      expect(build?.depends_on).toEqual(['verify-and-fix-plan']);
    });

    it('ak-implement runs Ralph as a native in-parent loop', () => {
      const workflow = Bun.YAML.parse(BUNDLED_WORKFLOWS['ak-implement']) as {
        nodes: Array<{
          id: string;
          bash?: string;
          cancel?: string;
          depends_on?: string[];
          effort?: string;
          model?: string;
          prompt?: string;
          provider?: string;
          trigger_rule?: string;
          when?: string;
          workflow?: string;
          output_format?: {
            required?: string[];
            properties?: { terminal?: { type?: string } };
          };
          loop?: {
            command?: string;
            fresh_context?: boolean;
            max_iterations?: number;
            until_bash?: string;
            until_field?: string;
          };
        }>;
      };

      expect(workflow.nodes.some(node => node.workflow === 'archon-ralph-dag-project-aware')).toBe(
        false
      );

      const setup = workflow.nodes.find(node => node.id === 'setup');
      expect(setup?.bash).toContain('$ARTIFACTS_DIR/ak-implement/base-sha.txt');

      const preflight = workflow.nodes.find(node => node.id === 'ralph-native-preflight');
      expect(preflight?.depends_on).toEqual(['build-ralph-prd']);
      expect(preflight?.bash).toContain('$build-ralph-prd.output.prd_dir');
      expect(preflight?.bash).toContain('$ARTIFACTS_DIR/superpowers/prd-dir.txt');
      expect(preflight?.bash).toContain('Invalid Ralph PRD');
      expect(preflight?.bash).toContain('bun install --frozen-lockfile');
      expect(preflight?.bash).toContain('npm ci');
      expect(preflight?.bash).toContain('yarn install --frozen-lockfile');
      expect(preflight?.bash).toContain('pnpm install --frozen-lockfile');

      const loop = workflow.nodes.find(node => node.id === 'ralph-loop-run');
      expect(loop?.depends_on).toEqual(['ralph-native-preflight']);
      expect(loop?.provider).toBe('omp');
      expect(loop?.model).toBe('xai-oauth/grok-4.5');
      expect(loop?.effort).toBe('high');
      expect(loop?.output_format?.properties?.terminal?.type).toBe('boolean');
      expect(loop?.output_format?.required).toContain('terminal');
      expect(loop?.loop?.command).toBe('archon-ralph-project-aware-iteration');
      expect(loop?.loop?.fresh_context).toBe(true);
      expect(loop?.loop?.max_iterations).toBe(100);
      expect(loop?.loop?.until_field).toBe('terminal');
      expect(loop?.loop?.until_bash).toContain('all(.[]; .passes == true)');

      const finalFix = workflow.nodes.find(node => node.id === 'codex-final-fix');
      expect(finalFix?.depends_on).toEqual(['ralph-loop-run']);
      expect(finalFix?.trigger_rule).toBe('all_done');
      expect(finalFix?.prompt).toContain('$ralph-loop-run.output');
      expect(finalFix?.prompt).toContain('$build-ralph-prd.output.prd_dir');
      expect(finalFix?.prompt).toContain('$ARTIFACTS_DIR/ak-implement/base-sha.txt');
      expect(finalFix?.prompt).toContain('resolve every repository-local blocker');
      expect(finalFix?.prompt).not.toContain('Superpowers');
      expect(finalFix?.prompt).not.toContain('hand fixes back to Grok');
      expect(finalFix?.prompt).not.toContain('implementation-report.md');

      expect(workflow.nodes.some(node => node.id === 'stop-on-final-fix-failure')).toBe(false);
      expect(finalFix?.when).toBeUndefined();
      expect(finalFix?.output_format?.required).not.toContain('gate');

      const createPr = workflow.nodes.find(node => node.id === 'create-pull-request');
      expect(createPr?.depends_on).toEqual(['codex-final-fix']);
      expect(createPr?.when).toBeUndefined();
    });

    it('ak-feature validates the BMAD story before planning and matches ak-implement afterward', () => {
      const workflow = Bun.YAML.parse(BUNDLED_WORKFLOWS['ak-feature']) as {
        interactive?: boolean;
        nodes: Array<{
          id: string;
          bash?: string;
          cancel?: string;
          depends_on?: string[];
          effort?: string;
          model?: string;
          prompt?: string;
          provider?: string;
          trigger_rule?: string;
          when?: string;
          workflow?: string;
          output_format?: {
            required?: string[];
            properties?: {
              report?: { type?: string };
              terminal?: { type?: string };
              plan_path?: { type?: string };
            };
          };
          loop?: {
            command?: string;
            fresh_context?: boolean;
            interactive?: boolean;
            max_iterations?: number;
            signal_completes?: boolean;
            until?: string;
            until_bash?: string;
            until_field?: string;
          };
        }>;
      };

      expect(workflow.nodes.some(node => node.workflow === 'archon-ralph-dag')).toBe(false);
      expect(workflow.nodes.some(node => node.id === 'ralph-implement')).toBe(false);
      expect(workflow.nodes.some(node => node.id === 'validate-plan')).toBe(false);
      expect(workflow.nodes.some(node => node.id === 'resolve-plan-source')).toBe(false);
      expect(workflow.nodes.some(node => node.id === 'verified-plan-ready')).toBe(false);
      expect(workflow.nodes.some(node => node.id === 'verified-plan-blocked')).toBe(false);
      expect(workflow.nodes.some(node => node.id === 'stop-on-final-fix-failure')).toBe(false);

      expect(workflow.interactive).toBe(true);
      const storyValidation = workflow.nodes.find(node => node.id === 'validate-bmad-story');
      expect(storyValidation?.depends_on).toEqual(['story-preflight']);
      expect(storyValidation?.provider).toBe('codex');
      expect(storyValidation?.model).toBe('gpt-6-sol');
      expect(storyValidation?.loop?.interactive).toBe(true);
      expect(storyValidation?.loop?.fresh_context).toBe(true);
      expect(storyValidation?.loop?.until).toBe('STORY_VALIDATION_PASSED');
      expect(storyValidation?.loop?.signal_completes).toBe(true);
      expect(storyValidation?.output_format).toBeUndefined();

      const plan = workflow.nodes.find(node => node.id === 'plan');
      expect(plan?.depends_on).toEqual(['validate-bmad-story']);
      expect(plan?.prompt).toContain('/ak:plan --deep --tdd');
      expect(plan?.provider).toBe('claude');
      expect(plan?.output_format?.required).toEqual(['plan_path']);
      expect(plan?.output_format?.properties?.plan_path?.type).toBe('string');
      expect(plan?.prompt).not.toContain('PLAN_DIR=');

      expect(workflow.nodes.some(node => node.id === 'resolve-plan')).toBe(false);

      const review = workflow.nodes.find(node => node.id === 'verify-and-fix-plan');
      expect(review?.depends_on).toEqual(['plan']);
      expect(review?.provider).toBe('codex');
      expect(review?.prompt).toContain('$plan.output.plan_path');
      expect(review?.output_format?.properties?.report?.type).toBe('string');
      expect(review?.when).toBeUndefined();

      const build = workflow.nodes.find(node => node.id === 'build-ralph-prd');
      expect(build?.depends_on).toEqual(['verify-and-fix-plan']);
      expect(build?.prompt).toContain('$plan.output.plan_path');
      expect(build?.prompt).not.toContain('$resolve-plan');
      expect(build?.prompt).toContain('never `.archon/ralph/`');

      const setup = workflow.nodes.find(node => node.id === 'setup');
      expect(setup?.bash).toContain('$ARTIFACTS_DIR/ak-feature/base-sha.txt');

      const preflight = workflow.nodes.find(node => node.id === 'ralph-native-preflight');
      expect(preflight?.depends_on).toEqual(['build-ralph-prd']);
      expect(preflight?.bash).toContain('$build-ralph-prd.output.prd_dir');
      expect(preflight?.bash).toContain('$ARTIFACTS_DIR/superpowers/prd-dir.txt');

      const loop = workflow.nodes.find(node => node.id === 'ralph-loop-run');
      expect(loop?.depends_on).toEqual(['ralph-native-preflight']);
      expect(loop?.provider).toBe('omp');
      expect(loop?.model).toBe('xai-oauth/grok-4.5');
      expect(loop?.loop?.command).toBe('archon-ralph-project-aware-iteration');
      expect(loop?.loop?.until_field).toBe('terminal');

      const finalFix = workflow.nodes.find(node => node.id === 'codex-final-fix');
      expect(finalFix?.depends_on).toEqual(['ralph-loop-run']);
      expect(finalFix?.trigger_rule).toBe('all_done');
      expect(finalFix?.prompt).toContain('$plan.output.plan_path');
      expect(finalFix?.prompt).not.toContain('$resolve-plan');
      expect(finalFix?.prompt).toContain('$ARTIFACTS_DIR/ak-feature/base-sha.txt');
      expect(finalFix?.when).toBeUndefined();
      expect(finalFix?.output_format?.required).not.toContain('gate');

      const createPr = workflow.nodes.find(node => node.id === 'create-pull-request');
      expect(createPr?.depends_on).toEqual(['codex-final-fix']);
      expect(createPr?.when).toBeUndefined();
    });

    it('archon-superpower-feature-verify-loop proves before PR and blocks on exhaustion', () => {
      const content = BUNDLED_WORKFLOWS['archon-superpower-feature-verify-loop'];
      expect(content).toContain('name: archon-superpower-feature-verify-loop');
      expect(content).toContain('id: setup');
      expect(content).toContain('id: write-plan');
      expect(content).toContain('id: review-fix-plan');
      expect(content).toContain('id: build-ralph-prd');
      expect(content).toContain('id: validate-prd');
      expect(content).toContain('id: ralph-loop-run');
      expect(content).toContain('id: select-verify-targets');
      expect(content).toContain('provider: grok');
      expect(content).toContain('model: grok-4.6');
      expect(content).toContain('skills:');
      expect(content).toContain('select-verify-archon-targets');
      expect(content).toContain('Follow select-verify-archon-targets.');
      expect(content).toContain('id: begin-verify');
      expect(content).toContain('id: finalize-change');
      expect(content).toContain('id: prepare-verify');
      expect(content).toContain('id: normalize-verify-targets');
      expect(content).toContain('id: prove');
      expect(content).toContain('id: record-verify');
      expect(content).toContain('id: verify-gate');
      expect(content).toContain('id: fix-verify');
      expect(content).toContain('id: authorize-pr');
      expect(content).toContain('id: create-pull-request');
      expect(content).toContain('id: verify-blocked');
      expect(content).toContain('provider: codex');
      expect(content).toContain('model: gpt-6-sol');
      expect(content).toContain('.agents/skills/verify-archon/bin/verify-archon');
      expect(content).not.toContain('.cursor/skills/verify-archon');
      expect(content).toContain('verify-feature-gate.ts normalize');
      expect(content).toContain('verify-feature-gate.ts prove');
      expect(content).toContain('verify-feature-gate.ts record');
      expect(content).toContain('condition: "$record-verify.output == \'true\'"');
      expect(content).toContain('negative: fix-verify');
      expect(content).toContain('exhausted: verify-blocked');
      expect(content).toContain('command: archon-create-pr');
      expect(content).toContain('verify-feature-gate.ts blocked');
      expect(content).not.toContain('id: prove-preflight');
      expect(content).not.toContain('$ARTIFACTS_DIR/verify/result.txt');
      expect(content).not.toContain('$ARTIFACTS_DIR/verify/feature-ids.txt');
      expect(content).not.toContain('TODO');
    });

    it('bmad readiness correction commands should not wait for interactive BMAD gates', () => {
      const readiness = BUNDLED_COMMANDS['bmad-check-implementation-readiness'];
      const correctCourse = BUNDLED_COMMANDS['bmad-correct-course'];
      const workflow = BUNDLED_WORKFLOWS['bmad-readiness-correct-course-loop'];

      expect(workflow).toContain('command: bmad-check-implementation-readiness');
      expect(workflow).toContain('command: bmad-correct-course');
      expect(readiness).toContain(
        'Do not present or wait at menus, including the Step 1 [C] checkpoint.'
      );
      expect(readiness).toContain(
        'Do not invoke `bmad-help` or start another interactive workflow.'
      );
      expect(correctCourse).toContain(
        "Treat this workflow invocation as the user's batch-mode selection and explicit approval"
      );
      expect(correctCourse).toContain(
        'Do not ask for the change trigger, mode selection, proposal review, Continue/Edit, yes/no approval, or any other user confirmation.'
      );
      expect(correctCourse).not.toContain(
        'Do not pause for user input unless the correction is impossible without missing project facts.'
      );
    });

    it('should have valid YAML structure', () => {
      for (const content of Object.values(BUNDLED_WORKFLOWS)) {
        expect(content).toContain('name:');
        expect(content).toContain('description:');
        expect(content.includes('nodes:')).toBe(true);
      }
    });

    it('no bundled bash node quote-wraps a $node.output reference (the executor already shell-quotes them)', () => {
      // A bash/until_bash node that writes "$x.output.field" or '$x.output.field'
      // is double-quoted at runtime: substituteNodeOutputRefs(escapedForBash=true)
      // injects an already single-quoted value, so the author's quotes become
      // literal characters inside the string and break every downstream path check.
      // Output refs in shell bodies MUST be spliced bare: VAR=$x.output.field.
      const quotedBefore = /(["'])\$[A-Za-z_][A-Za-z0-9_-]*\.output/;
      const quotedAfter = /\$[A-Za-z_][A-Za-z0-9_-]*\.output(?:\.[A-Za-z_][A-Za-z0-9_]*)?["']/;
      const offenders: string[] = [];
      for (const [name, yaml] of Object.entries(BUNDLED_WORKFLOWS)) {
        const wf = Bun.YAML.parse(yaml) as { nodes?: Array<Record<string, unknown>> };
        for (const node of wf.nodes ?? []) {
          for (const key of ['bash', 'until_bash'] as const) {
            const body = node[key];
            if (typeof body !== 'string') continue;
            body.split('\n').forEach((line, i) => {
              if (quotedBefore.test(line) || quotedAfter.test(line)) {
                offenders.push(`${name}:${String(node.id)}:${key}:${i + 1}: ${line.trim()}`);
              }
            });
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('fork-safe PR creation (#2226)', () => {
    // In a clone of a fork, gh commands without an explicit --repo resolve the
    // base repo to the fork's UPSTREAM parent, publishing the user's diff
    // against the upstream repo (accidental upstream PRs #1543/#1416). Every
    // `gh pr create` invocation in the bundled defaults must pin `--repo` —
    // and so must the create-flow-adjacent `gh pr list/edit/ready` calls that
    // discover or mutate the just-created PR (an empty/unset --repo value does
    // NOT fail: gh silently falls back to its default resolution, verified).
    // `gh pr view` is intentionally NOT guarded here: review-path commands
    // (archon-pr-review-scope etc.) view explicit PR numbers supplied as
    // workflow input — pinning those is a separate concern.

    // Join backslash-continued shell lines so multi-line `gh pr create \`
    // blocks are checked as a single command.
    const mergeContinuations = (content: string): string[] => {
      const merged: string[] = [];
      let current = '';
      for (const line of content.split('\n')) {
        if (line.trimEnd().endsWith('\\')) {
          current += line.trimEnd().slice(0, -1) + ' ';
        } else {
          merged.push(current + line);
          current = '';
        }
      }
      if (current) merged.push(current);
      return merged;
    };

    const GUARDED = /gh pr (create|list|edit|ready)\b/;

    /** True when the merged line is a real gh pr invocation that must pin --repo. */
    const isGuardedInvocation = (line: string): boolean => {
      if (!GUARDED.test(line)) return false;
      // Prose references to a failed command (hook texts) are not invocations.
      if (line.includes('gh pr create failed')) return false;
      // Docs/hard-rule prose mentioning `gh pr …` in backticks is not an invocation
      // (#2226 still requires every real shell call to pin --repo).
      if (
        /`gh pr (create|list|edit|ready)`/.test(line) &&
        !/(?:^|[;&|($\s])gh pr (create|list|edit|ready)\b/.test(
          line.replace(/`gh pr (?:create|list|edit|ready)`/g, '')
        )
      ) {
        return false;
      }
      return true;
    };

    const assertPinned = (bundle: Record<string, string>): void => {
      for (const [name, content] of Object.entries(bundle)) {
        for (const line of mergeContinuations(content)) {
          if (!isGuardedInvocation(line)) continue;
          expect(`${name}: ${line.trim()}`).toContain('--repo');
        }
      }
    };

    it('classifies backtick prose as non-invocation and unpinned shell calls as violations', () => {
      const hardRule =
        '**Hard rule — no pull request:** never `git push` for the purpose of opening a PR, never `gh pr create` / `gh pr edit`, and never treat PR creation as completion.';
      const noPrBullet = '- **NO_PR**: No push-for-PR and no `gh pr create`';
      const realCreate = 'gh pr create --title "x" --body "y"';
      const realPinned = 'gh pr create --repo "$PR_REPO" --title "x" --body "y"';
      const realList = 'gh pr list --head "$PR_HEAD"';
      const failedProse = 'echo "gh pr create failed: $err"';
      const mixed = 'never `gh pr create` but also run: gh pr create --title t';

      expect(isGuardedInvocation(hardRule)).toBe(false);
      expect(isGuardedInvocation(noPrBullet)).toBe(false);
      expect(isGuardedInvocation(failedProse)).toBe(false);
      expect(isGuardedInvocation(realCreate)).toBe(true);
      expect(isGuardedInvocation(realPinned)).toBe(true);
      expect(isGuardedInvocation(realList)).toBe(true);
      // Backticks alone are not enough when a real invocation remains on the line.
      expect(isGuardedInvocation(mixed)).toBe(true);

      expect(() => assertPinned({ 'bad-create': realCreate })).toThrow(/--repo/);
      expect(() => assertPinned({ 'bad-list': realList })).toThrow(/--repo/);
      expect(() => assertPinned({ prose: hardRule })).not.toThrow();
      expect(() => assertPinned({ ok: realPinned })).not.toThrow();
    });

    it('every gh pr create/list/edit/ready in bundled commands pins --repo', () => {
      assertPinned(BUNDLED_COMMANDS);
    });

    it('every gh pr create/list/edit/ready in bundled workflows pins --repo', () => {
      assertPinned(BUNDLED_WORKFLOWS);
    });
  });

  describe('resolve-plan (plan path + co-located PRD dir)', () => {
    // Exercises the SHIPPED bundled resolve-plan bash end-to-end. It consumes
    // $resolve-plan-source.output.plan_path (a local dir or .md file) and emits
    // JSON {plan_path, prd_dir}. Co-location: a directory plan → prd_dir is that
    // dir; a canonical `.../plan.md` → normalized to its DIRECTORY (plan_path =
    // dir, prd_dir = dir); any other `.md` → sibling <dirname(dirname)>/ralph/<name>/.
    // NEVER .archon/ralph/.
    type ResolveJson = { plan_path: string; prd_dir: string };

    function resolvePlanBash(): string {
      const wf = Bun.YAML.parse(BUNDLED_WORKFLOWS['ak-implement']) as {
        nodes: Array<{ id: string; bash?: string }>;
      };
      const node = wf.nodes.find(n => n.id === 'resolve-plan');
      if (!node?.bash) throw new Error('resolve-plan bash node missing from ak-implement');
      return node.bash;
    }

    function runResolve(
      planInput: string,
      setup: (root: string) => void
    ): { status: number | null; json: ResolveJson | null } {
      const root = mkdtempSync(join(tmpdir(), 'resolve-plan-'));
      try {
        setup(root);
        // resolve-plan reads $resolve-plan-source.output.plan_path. Substitute it
        // through the SAME path the executor uses for bash nodes —
        // substituteNodeOutputRefs(..., escapedForBash=true) — so the injected value
        // is shell-quoted EXACTLY as at runtime. Splicing the raw path in (the prior
        // version of this helper) hid the failure mode where the node wrapped the ref
        // in its own quotes: the executor's single-quotes then land inside the string
        // and every path check fails with "resolved plan path does not exist".
        const nodeOutputs = new Map<string, NodeOutput>([
          [
            'resolve-plan-source',
            { state: 'completed', output: JSON.stringify({ plan_path: planInput }) },
          ],
        ]);
        const bash = substituteNodeOutputRefs(resolvePlanBash(), nodeOutputs, true);
        const result = spawnSync('bash', ['-c', bash], { cwd: root, encoding: 'utf8' });
        let json: ResolveJson | null = null;
        try {
          json = JSON.parse((result.stdout ?? '').trim()) as ResolveJson;
        } catch {
          json = null;
        }
        return { status: result.status, json };
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    it('directory plan → prd_dir is the plan directory itself', () => {
      const res = runResolve('plans/my-feature', root => {
        mkdirSync(join(root, 'plans/my-feature'), { recursive: true });
        writeFileSync(join(root, 'plans/my-feature/plan.md'), '# plan\n');
      });
      expect(res.status).toBe(0);
      expect(res.json?.plan_path.endsWith('/plans/my-feature')).toBe(true);
      expect(res.json?.prd_dir).toBe(res.json?.plan_path);
    });

    it('canonical <slug>/plan.md → normalized to its directory (not plans/ralph/plan)', () => {
      const res = runResolve('plans/260901-datetime/plan.md', root => {
        mkdirSync(join(root, 'plans/260901-datetime'), { recursive: true });
        writeFileSync(join(root, 'plans/260901-datetime/plan.md'), '# plan\n');
        writeFileSync(join(root, 'plans/260901-datetime/phase-01.md'), '# phase\n');
      });
      expect(res.status).toBe(0);
      expect(res.json?.plan_path.endsWith('/plans/260901-datetime')).toBe(true);
      expect(res.json?.prd_dir).toBe(res.json?.plan_path);
    });

    it('file plan under docs/superpowers/plans → PRD in docs/superpowers/ralph/<name>', () => {
      const res = runResolve('docs/superpowers/plans/test-feedback-loop.md', root => {
        mkdirSync(join(root, 'docs/superpowers/plans'), { recursive: true });
        writeFileSync(join(root, 'docs/superpowers/plans/test-feedback-loop.md'), '# plan\n');
      });
      expect(res.status).toBe(0);
      expect(res.json?.plan_path.endsWith('/docs/superpowers/plans/test-feedback-loop.md')).toBe(
        true
      );
      expect(res.json?.prd_dir.endsWith('/docs/superpowers/ralph/test-feedback-loop')).toBe(true);
    });

    it('file plan under plans/architectures → PRD in plans/ralph/<name>', () => {
      const res = runResolve('plans/architectures/3-8-list-sessions.md', root => {
        mkdirSync(join(root, 'plans/architectures'), { recursive: true });
        writeFileSync(join(root, 'plans/architectures/3-8-list-sessions.md'), '# plan\n');
      });
      expect(res.status).toBe(0);
      expect(res.json?.prd_dir.endsWith('/plans/ralph/3-8-list-sessions')).toBe(true);
    });

    it('exits 1 when the resolved plan path is empty', () => {
      const res = runResolve('', () => {});
      expect(res.status).toBe(1);
    });

    it('exits 1 when the plan path does not exist', () => {
      const res = runResolve('plans/nope', () => {});
      expect(res.status).toBe(1);
    });

    it('exits 1 when a file plan is not .md', () => {
      const res = runResolve('notes.txt', root => {
        writeFileSync(join(root, 'notes.txt'), 'x\n');
      });
      expect(res.status).toBe(1);
    });
  });
});
