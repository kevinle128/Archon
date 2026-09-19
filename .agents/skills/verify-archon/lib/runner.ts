import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from '@hono/zod-openapi';
import {
  catalogSchema, selectionSchema, digest, normalizeProposal, guardResult, resultSchema,
  type Catalog, type Selection, type ProofResult,
} from './contract';
import { SKILL_ROOT, TOOLING_REPO, ARTIFACT_SUBTREE, readJson, writeJson, snapshot, toolingDigest, loadCatalog, evidenceDirectory, attachmentInventory } from './io';
import { runCliScenario, command, isolatedEnvironment } from './cli-scenarios';
import { runApiScenario } from './api-scenario';
import { browserCases, runBrowserScenario } from './browser-scenarios';
import { protocolSchema } from './schema-validation';
import { checkVisualSources, visualBinding } from './visual-review';

const cliBindings = new Set(['install.health', 'workflow.execution', 'workflow.governance', 'workflow.invalid-input']);
export function validateRunnable(catalog: Catalog, ids = catalog.features.flatMap(feature => feature.scenarios.map(item => item.id)), _evidenceRoot?: string): void {
  for (const id of ids) {
    const scenario = catalog.features.flatMap(feature => feature.scenarios).find(item => item.id === id);
    if (!scenario) throw new Error(`Unknown scenario ${id}`);
    const binding = scenario.runner;
    if (binding.id !== (id === 'ui.visual' ? visualBinding() : id) || !(
      (binding.kind === 'cli' && cliBindings.has(binding.id)) ||
      (binding.kind === 'http' && binding.id === 'http.lifecycle') ||
      (binding.kind === 'browser' && Object.hasOwn(browserCases, id))
    )) throw new Error(`Unsupported runner binding ${binding.kind}:${binding.id}`);
  }
}
export async function validateSelection(catalog: Catalog, repo: string, input: unknown, base?: string, historical = false): Promise<Selection> {
  const selection = selectionSchema.parse(input);
  const current = await snapshot(repo, base);
  const expected = normalizeProposal(catalog, selection.proposal, current, historical);
  if (digest(expected) !== digest(selection)) throw new Error('Selection was changed or catalog is stale');
  validateRunnable(catalog, selection.scenario_ids);
  if (selection.scenario_ids.includes('ui.visual')) await checkVisualSources(repo);
  return selection;
}
export async function doctor(repo: string): Promise<{ ok: boolean; repo: string; version: string; tooling: string }> {
  repo = await realpath(repo);
  const manifest = z.object({ name: z.literal('archon'), version: z.string() }).parse(await readJson(join(repo, 'package.json')));
  await stat(join(repo, 'packages/cli/src/cli.ts'));
  protocolSchema('contract').parse(await readJson(join(SKILL_ROOT, 'contract.json')));
  const catalog = await loadCatalog();
  protocolSchema('catalog').parse(catalogSchema.parse(catalog));
  validateRunnable(catalog);
  return { ok: true, repo, version: manifest.version, tooling: TOOLING_REPO };
}
export async function prove(
  catalog: Catalog, repo: string, ids: string[], evidenceRoot: string,
  selection?: Selection, base?: string,
  options: { historical?: boolean; selectionPath?: string; preflightError?: string } = {},
): Promise<ProofResult> {
  repo = resolve(repo);
  try { repo = await realpath(repo); } catch { /* The proof records an invalid target below. */ }
  let evidence: string;
  let pathError: string | undefined;
  try { evidence = await evidenceDirectory(repo, evidenceRoot); }
  catch (error) {
    pathError = String(error);
    evidence = await evidenceDirectory(TOOLING_REPO, join(TOOLING_REPO, ARTIFACT_SUBTREE, 'failed-preflight', randomUUID(), 'evidence'));
  }
  const result: ProofResult = {
    version: 1, run_id: randomUUID(), mode: selection || options.selectionPath ? 'selection' : 'scenario-debug',
    repo, product: null, catalog_sha256: null, selection_sha256: null, tooling_sha256: null,
    behavior_ids: selection?.behavior_ids ?? [], scenario_ids: ids, scenarios: [], errors: [],
    ok: false, verdict: 'FAIL', evidence_dir: evidence,
  };
  try {
    if (pathError || options.preflightError) throw new Error(pathError ?? options.preflightError);
    await doctor(repo);
    result.product = await snapshot(repo, base);
    result.catalog_sha256 = catalog.catalog_sha256;
    result.tooling_sha256 = await toolingDigest();
    if (selection) {
      await validateSelection(catalog, repo, selection, base, options.historical);
      result.selection_sha256 = digest(selection);
    }
    validateRunnable(catalog, ids);
    await writeJson(join(evidence, 'proof-context.json'), {
      run_id: result.run_id, repo, product: result.product,
      catalog_sha256: result.catalog_sha256, selection_sha256: result.selection_sha256,
      tooling_sha256: result.tooling_sha256,
    });
    if (ids.some(id => id.startsWith('ui.') || id === 'http.lifecycle')) {
      // Build the exact target for each public proof; do not trust an ambient dist.
      const build = await command(['bun', 'run', 'build:web'], repo, isolatedEnvironment(evidence), 180_000);
      await writeJson(join(evidence, 'build.json'), build);
      if (build.exit !== 0) throw new Error(`Target Web build failed (setup): ${build.stderr}`);
    }
    for (const id of ids) {
      const scenario = cliBindings.has(id) ? await runCliScenario(repo, id, evidence)
        : id === 'http.lifecycle' ? await runApiScenario(repo, id, evidence)
          : await runBrowserScenario(repo, id, evidence);
      result.scenarios.push(scenario);
      // Persist progress as FAIL so a process interruption cannot leave a PASS.
      await writeJson(join(evidence, 'progress.json'), result);
    }
    const currentCatalog = await loadCatalog();
    const currentSelection = options.selectionPath ? selectionSchema.parse(await readJson(options.selectionPath)) : selection;
    if (currentSelection) await validateSelection(currentCatalog, repo, currentSelection, base, options.historical);
    const inventory = await attachmentInventory(evidence, result.scenarios.flatMap(item => item.attachments.map(attachment => attachment.path)));
    result.ok = true;
    result.verdict = 'PASS';
    result.errors = guardResult(result, {
      run_id: result.run_id, repo, evidence_dir: evidence,
      required_behavior_ids: selection?.behavior_ids ?? [], required_scenario_ids: ids,
      product: await snapshot(repo, base), catalog_sha256: currentCatalog.catalog_sha256,
      selection_sha256: currentSelection ? digest(currentSelection) : null,
      tooling_sha256: await toolingDigest(), attachment_inventory: inventory,
    });
  } catch (error) { result.errors.push(error instanceof Error ? error.message : String(error)); }
  result.ok = result.errors.length === 0;
  result.verdict = result.ok ? 'PASS' : 'FAIL';
  resultSchema.parse(result);
  protocolSchema('result').parse(result);
  try { await writeJson(join(evidence, 'result.json'), result); }
  catch (error) {
    result.ok = false;
    result.verdict = 'FAIL';
    result.errors.push(`Evidence persistence failed at ${evidence}: ${String(error)}`);
    // Keep a fresh failure receipt when the requested evidence volume stops accepting writes.
    result.evidence_dir = await evidenceDirectory(TOOLING_REPO, join(TOOLING_REPO, ARTIFACT_SUBTREE, 'failed-persistence', randomUUID(), 'evidence'));
    await writeJson(join(result.evidence_dir, 'result.json'), result);
  }
  return result;
}
