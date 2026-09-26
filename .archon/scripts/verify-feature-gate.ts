import { z } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  digest,
  guardResult,
  normalizeProposal,
  proposalSchema,
  selectionSchema,
  resultSchema,
  type Selection,
} from '../../.agents/skills/verify-archon/lib/contract';
import {
  git,
  attachmentInventory,
  loadCatalog,
  readJson,
  toolingDigest,
  writeJson,
} from '../../.agents/skills/verify-archon/lib/io';
import {
  prove,
  validateRunnable,
  validateSelection,
} from '../../.agents/skills/verify-archon/lib/runner';

const attemptSchema = z.object({ id: z.uuid(), repo: z.string() }).strict();
const normalizationSchema = z
  .object({
    ok: z.boolean(),
    selection_sha256: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();
const executionSchema = z
  .object({
    completed: z.boolean(),
    result_path: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();
const gateSchema = z.object({
  ok: z.boolean(),
  verdict: z.enum(['PASS', 'FAIL']),
  behavior_ids: z.array(z.string()),
  scenario_ids: z.array(z.string()),
  result_path: z.string().nullable(),
  errors: z.array(z.string()),
});
export type Gate = z.infer<typeof gateSchema>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attemptDir(repo: string, artifacts: string, expectedId?: string): Promise<string> {
  const attempt = attemptSchema.parse(await readJson(join(artifacts, 'verify/current.json')));
  if (attempt.repo !== repo) throw new Error('Verification attempt belongs to another checkout');
  if (
    expectedId !== undefined &&
    (!z.uuid().safeParse(expectedId).success || attempt.id !== expectedId)
  )
    throw new Error('Missing or mismatched successful begin receipt for this execution');
  return join(artifacts, 'verify/attempts', attempt.id);
}

export async function beginAttempt(repo: string, artifacts: string): Promise<string> {
  const id = randomUUID();
  await mkdir(join(artifacts, 'verify/attempts', id), { recursive: true });
  // Invalidate the previous attempt before any AI or install can fail.
  await writeJson(join(artifacts, 'verify/current.json'), { id, repo });
  return id;
}

export async function prepareAttempt(repo: string, artifacts: string): Promise<void> {
  await attemptDir(repo, artifacts);
  await loadCatalog();
}

export async function normalizeAttempt(
  repo: string,
  artifacts: string,
  input: unknown
): Promise<Selection> {
  const dir = await attemptDir(repo, artifacts);
  await writeJson(join(dir, 'normalization.json'), { ok: false });
  await writeJson(join(dir, 'execution.json'), { completed: false });
  await writeJson(join(dir, 'proposal.json'), input);
  try {
    const proposal = proposalSchema.parse(input);
    const catalog = await loadCatalog();
    const selected = normalizeProposal(catalog, proposal);
    await validateRunnable(catalog, selected.scenario_ids, dir);
    await writeJson(join(dir, 'selection.json'), selected);
    await writeJson(join(dir, 'normalization.json'), {
      ok: true,
      selection_sha256: digest(selected),
    });
    return selected;
  } catch (error) {
    await writeJson(join(dir, 'normalization.json'), { ok: false, error: errorMessage(error) });
    throw error;
  }
}

async function currentSelection(dir: string): Promise<Selection> {
  const receipt = normalizationSchema.parse(await readJson(join(dir, 'normalization.json')));
  if (!receipt.ok)
    throw new Error(receipt.error ?? 'Normalization did not complete for this attempt');
  const selected = selectionSchema.parse(await readJson(join(dir, 'selection.json')));
  if (receipt.selection_sha256 !== digest(selected))
    throw new Error('Normalized selection was modified');
  return validateSelection(await loadCatalog(), selected);
}

export async function proveAttempt(repo: string, artifacts: string): Promise<boolean> {
  const dir = await attemptDir(repo, artifacts);
  await writeJson(join(dir, 'execution.json'), { completed: false });
  try {
    const selection = await currentSelection(dir);
    // Same executable runner as `verify-archon prove --selection`, without an AI verdict.
    const result = await prove(
      await loadCatalog(),
      repo,
      selection.scenario_ids,
      join(dir, 'evidence'),
      selection
    );
    await writeJson(join(dir, 'execution.json'), {
      completed: true,
      result_path: join(result.evidence_dir, 'result.json'),
    });
    return result.ok;
  } catch (error) {
    await writeJson(join(dir, 'execution.json'), { completed: false, error: errorMessage(error) });
    throw error;
  }
}

export async function recordAttempt(
  repo: string,
  artifacts: string,
  expectedId: string
): Promise<Gate> {
  const gate = gateSchema.parse({
    ok: false,
    verdict: 'FAIL',
    behavior_ids: [],
    scenario_ids: [],
    result_path: null,
    errors: [],
  });
  try {
    const dir = await attemptDir(repo, artifacts, expectedId);
    const selected = await currentSelection(dir);
    gate.behavior_ids = selected.behavior_ids;
    gate.scenario_ids = selected.scenario_ids;
    const receipt = executionSchema.parse(await readJson(join(dir, 'execution.json')));
    if (!receipt.completed || !receipt.result_path)
      throw new Error(receipt.error ?? 'Proof did not complete for this attempt');
    const resultPath = resolve(receipt.result_path);
    const within = relative(join(dir, 'evidence'), resultPath);
    if (isAbsolute(within) || within.startsWith('..') || basename(resultPath) !== 'result.json')
      throw new Error('Proof result is not evidence from the current attempt');
    gate.result_path = resultPath;
    const result = resultSchema.parse(await readJson(resultPath));
    if (result.mode !== 'selection') throw new Error('Proof must execute the selected targets');
    gate.errors.push(...guardResult(result, {
      run_id: result.run_id,
      repo,
      evidence_dir: dirname(resultPath),
      required_behavior_ids: selected.behavior_ids,
      required_scenario_ids: selected.scenario_ids,
      product: null,
      catalog_sha256: selected.catalog_sha256,
      selection_sha256: digest(selected),
      tooling_sha256: await toolingDigest(),
      attachment_inventory: await attachmentInventory(
        dirname(resultPath),
        result.scenarios.flatMap(item => item.attachments.map(attachment => attachment.path))
      ),
    }));
    gate.ok = gate.errors.length === 0;
    gate.verdict = gate.ok ? 'PASS' : 'FAIL';
  } catch (error) {
    gate.errors.push(errorMessage(error));
  }
  await mkdir(join(artifacts, 'verify'), { recursive: true });
  await writeJson(join(artifacts, 'verify/gate.json'), gate);
  await writeFile(join(artifacts, 'verify/report.md'), renderGate(gate));
  return gate;
}

export function renderGate(gate: Gate): string {
  return [
    '# Feature verification',
    '',
    `Verdict: ${gate.verdict}`,
    '',
    '## Behaviors',
    ...gate.behavior_ids.map(id => `- ${id}`),
    '',
    '## Required Scenarios',
    ...gate.scenario_ids.map(id => `- ${id}`),
    '',
    '## Evidence',
    gate.result_path ?? 'No complete executable result for this attempt.',
    '',
    '## Failures',
    ...gate.errors.map(error => `- ${error}`),
    '',
  ].join('\n');
}

export async function assertPass(
  repo: string,
  artifacts: string,
  expectedId: string
): Promise<Gate> {
  const gate = await recordAttempt(repo, artifacts, expectedId);
  if (!gate.ok) throw new Error(`PR blocked: ${gate.errors.join('; ')}`);
  return gate;
}

async function main(): Promise<void> {
  const artifacts = process.env.ARTIFACTS_DIR;
  if (!artifacts) throw new Error('ARTIFACTS_DIR is required for the workflow adapter');
  const repo = (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).trim();
  const root = resolve(artifacts);
  switch (process.argv[2]) {
    case 'begin':
      console.log(await beginAttempt(repo, root));
      break;
    case 'prepare':
      await prepareAttempt(repo, root);
      break;
    case 'normalize':
      console.log(
        JSON.stringify(
          await normalizeAttempt(repo, root, JSON.parse(await Bun.stdin.text()) as unknown)
        )
      );
      break;
    case 'prove':
      process.exitCode = (await proveAttempt(repo, root)) ? 0 : 1;
      break;
    case 'record':
      // Bash route sources consume a JSON scalar; full provenance stays in gate.json.
      console.log(JSON.stringify((await recordAttempt(repo, root, process.argv[3] ?? '')).ok));
      break;
    case 'assert-pass':
      console.log(JSON.stringify(await assertPass(repo, root, process.argv[3] ?? '')));
      break;
    case 'blocked': {
      const gate = await recordAttempt(repo, root, process.argv[3] ?? '');
      await writeFile(
        join(root, 'verify/BLOCKED.md'),
        `# Verification fix budget exhausted\n\nNo pull request was created.\n\n${renderGate(gate)}`
      );
      console.error(`Verification blocked. See ${join(root, 'verify/BLOCKED.md')}`);
      process.exitCode = 1;
      break;
    }
    default:
      throw new Error('Expected begin, prepare, normalize, prove, record, assert-pass, or blocked');
  }
}

if (import.meta.main) {
  main().catch((error: unknown): void => {
    console.error(JSON.stringify({ ok: false, error: errorMessage(error) }));
    process.exitCode = 1;
  });
}
