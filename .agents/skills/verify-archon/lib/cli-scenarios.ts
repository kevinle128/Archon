import assert from 'node:assert/strict';
import { env as hostEnvironment } from 'node:process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from '@hono/zod-openapi';
import { Database } from 'bun:sqlite';
import { git, writeJson } from './io';
import type { ScenarioResult } from './contract';

export function isolatedEnvironment(home: string): Record<string, string> {
  return {
    PATH: hostEnvironment.PATH ?? '', HOME: hostEnvironment.HOME ?? '', TMPDIR: tmpdir(),
    ARCHON_HOME: home, DATABASE_URL: '', ARCHON_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1', NO_COLOR: '1', LOG_LEVEL: 'error',
    SLACK_BOT_TOKEN: '', SLACK_APP_TOKEN: '', TELEGRAM_BOT_TOKEN: '', DISCORD_BOT_TOKEN: '',
    GITHUB_TOKEN: '', GITHUB_APP_ID: '', GITEA_TOKEN: '', GITLAB_TOKEN: '', BETTER_AUTH_SECRET: '',
  };
}
export async function command(
  argv: string[], cwd: string, env: Record<string, string>, timeout = 30_000,
): Promise<{ argv: string[]; pid: number; cwd: string; exit: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(argv, { cwd, env, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  let timedOut = false;
  let force: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout((): void => {
    timedOut = true;
    child.kill('SIGTERM');
    force = setTimeout((): void => { child.kill('SIGKILL'); }, 3000);
  }, timeout);
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { argv, pid: child.pid, cwd, exit: timedOut ? 124 : exit, stdout, stderr };
  } finally {
    clearTimeout(timer);
    if (force) clearTimeout(force);
  }
}
const envelopeSchema = z.object({
  success: z.boolean(), workflowRunRef: z.object({ runId: z.string() }).passthrough().optional(),
  result: z.record(z.string(), z.unknown()).optional(), error: z.unknown().optional(),
}).passthrough();

export async function runCliScenario(repo: string, id: string, evidence: string): Promise<ScenarioResult> {
  const scratch = await mkdtemp(join(tmpdir(), 'archon-verify-cli-'));
  const home = join(scratch, 'home');
  const cwd = join(scratch, 'project');
  const transcript: unknown[] = [];
  const errors: string[] = [];
  const attachment = `${id}.json`;
  let cleaned = false;
  const env = isolatedEnvironment(home);
  const cli = async (args: string[], expected?: number): Promise<Awaited<ReturnType<typeof command>>> => {
    const result = await command(['bun', join(repo, 'packages/cli/src/cli.ts'), ...args], cwd, env);
    transcript.push(result);
    await writeJson(join(evidence, attachment), { scratch, commands: transcript, cleaned });
    if (expected !== undefined) assert.equal(result.exit, expected, `${args.join(' ')}: ${result.stderr}\n${result.stdout}`);
    return result;
  };
  const json = async (args: string[], expected = 0): Promise<z.infer<typeof envelopeSchema>> => {
    const result = await cli([...args, '--json'], expected);
    return envelopeSchema.parse(JSON.parse(result.stdout));
  };
  const stored = (runId: string): Record<string, unknown> => {
    const db = new Database(join(home, 'archon.db'), { readonly: true });
    try {
      const row = z.record(z.string(), z.unknown()).parse(db.query('SELECT * FROM remote_agent_workflow_runs WHERE id = ?').get(runId));
      transcript.push({ databaseRun: row });
      return row;
    } finally { db.close(); }
  };
  const run = async (name: string, expected = 0): Promise<string> => {
    const result = await json(['workflow', 'run', name, '--no-worktree'], expected);
    const runId = result.success ? result.workflowRunRef?.runId
      : z.object({ details: z.object({ runId: z.string() }) }).parse(result.error).details.runId;
    assert.ok(runId, 'Run must return its persisted identity');
    return runId;
  };
  try {
    await mkdir(join(cwd, '.archon/workflows'), { recursive: true });
    await mkdir(home);
    await git(cwd, ['init', '-q']);
    const definitions = [
      { name: 'verify-success', description: 'Verifier deterministic workflow', nodes: [
        { id: 'first', bash: 'mkdir -p "$ARTIFACTS_DIR"; echo verified > "$ARTIFACTS_DIR/proof.txt"; echo first-output' },
        { id: 'second', depends_on: ['first'], bash: 'echo second-output' },
      ] },
      { name: 'verify-gate', description: 'Verifier approval', nodes: [
        { id: 'gate', approval: { message: 'Approve the verifier fixture' } },
        { id: 'after', depends_on: ['gate'], bash: 'echo gate-approved' },
      ] },
      { name: 'verify-failure', description: 'Verifier failure and retry', nodes: [
        { id: 'fails-once', bash: 'if [ ! -f "$ARCHON_HOME/retry-marker" ]; then touch "$ARCHON_HOME/retry-marker"; exit 7; fi; echo recovered' },
      ] },
    ];
    for (const definition of definitions) await writeFile(join(cwd, '.archon/workflows', definition.name + '.yaml'), JSON.stringify(definition));
    await git(cwd, ['add', '.archon']);
    await git(cwd, ['-c', 'user.name=Verification Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: initialize disposable workflow fixture']);
    if (id === 'install.health') {
      const manifest = z.object({ version: z.string() }).parse(JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')));
      const version = await cli(['version'], 0);
      assert.ok(version.stdout.includes(manifest.version), 'CLI version must match the target manifest');
      const help = await cli(['--help'], 0);
      assert.ok(help.stdout.includes('workflow'));
      const list = await cli(['workflow', 'list', '--json'], 0);
      assert.ok(list.stdout.includes('verify-success'));
      JSON.parse(list.stdout);
      await cli(['validate', 'workflows', 'verify-success', '--json'], 0);
      await writeFile(join(cwd, '.archon/workflows/invalid.yaml'), 'name: invalid\ndescription: Verifier missing dependency\nnodes: [{id: broken, depends_on: [missing], bash: echo broken}]');
      const invalid = await cli(['validate', 'workflows', 'invalid', '--json'], 1);
      const validation = z.object({ results: z.array(z.object({
        workflowName: z.string(), valid: z.boolean(),
        issues: z.array(z.object({ level: z.string(), message: z.string() })),
      })) }).parse(JSON.parse(invalid.stdout));
      assert.ok(validation.results.some(result => result.workflowName === 'invalid' && !result.valid &&
        result.issues.some(issue => issue.level === 'error' &&
          issue.message === "Node 'broken' depends_on unknown node 'missing'")),
      'Invalid DAG must fail on its missing dependency');
    } else if (id === 'workflow.execution') {
      const runId = await run('verify-success');
      const row = stored(runId);
      assert.equal(row.status, 'completed');
      await json(['workflow', 'get', runId]);
      const db = new Database(join(home, 'archon.db'), { readonly: true });
      try {
        const events = db.query('SELECT * FROM remote_agent_workflow_events WHERE workflow_run_id = ?').all(runId);
        transcript.push({ events });
        assert.ok(JSON.stringify(events).includes('second-output'));
      } finally { db.close(); }
      assert.equal(await readFile(join(String(row.output_root), 'artifacts/runs', runId, 'proof.txt'), 'utf8'), 'verified\n');
      const failed = await run('verify-failure', 78);
      assert.equal(stored(failed).status, 'failed');
      // The blocking public retry entry point keeps process ownership explicit.
      await cli(['workflow', 'retry-node', failed, 'fails-once'], 0);
      assert.equal(stored(failed).status, 'completed');
    } else if (id === 'workflow.governance') {
      const approveId = await run('verify-gate');
      assert.equal(stored(approveId).status, 'paused');
      await json(['workflow', 'approve', approveId]);
      assert.equal(stored(approveId).status, 'paused', 'JSON approval records only; it must not execute');
      await cli(['workflow', 'resume', approveId], 0);
      assert.equal(stored(approveId).status, 'completed');
      const rejectId = await run('verify-gate');
      const rejected = await json(['workflow', 'reject', rejectId]);
      assert.deepEqual(rejected.result?.decision, { outcome: 'rejected', recorded: true });
      assert.equal(stored(rejectId).status, 'cancelled', 'Rejection without on_reject must cancel the persisted run');
      const cancelId = await run('verify-gate');
      await json(['workflow', 'cancel', cancelId]);
      assert.equal(stored(cancelId).status, 'cancelled');
    } else if (id === 'workflow.invalid-input') {
      for (const args of [['workflow', 'run'], ['workflow', 'get'], ['workflow', 'approve'], ['workflow', 'resume'], ['workflow', 'cancel']]) {
        const output = await json(args, 64);
        assert.equal(output.success, false);
      }
      assert.equal((await json(['workflow', 'run', 'no-such-verifier-workflow', '--no-worktree'], 78)).success, false);
      assert.equal((await json(['workflow', 'get', '00000000-0000-4000-8000-000000000000'], 78)).success, false);
    } else throw new Error(`Unsupported CLI scenario ${id}`);
  } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  finally {
    try { await rm(scratch, { recursive: true, force: true }); cleaned = true; }
    catch (error) { errors.push(`Cleanup failed: ${String(error)}`); }
    await writeJson(join(evidence, attachment), { scratch, commands: transcript, cleaned, errors });
  }
  return { id, status: errors.length ? 'failed' : 'passed', errors,
    attachments: [{ name: `${id}.transcript`, path: attachment }] };
}
