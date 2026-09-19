#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { loadCatalog, readJson, writeJson, snapshot, ARTIFACT_SUBTREE } from '../lib/io';
import { catalogSchema, normalizeProposal, selectionSchema, type Selection } from '../lib/contract';
import { prove, validateSelection, validateRunnable, doctor } from '../lib/runner';

async function main(): Promise<unknown> {
  const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), strict: true, allowPositionals: true,
    options: { repo: { type: 'string' }, base: { type: 'string' }, out: { type: 'string' },
      selection: { type: 'string' }, scenario: { type: 'string' }, 'evidence-root': { type: 'string' },
      historical: { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) return {
    protocol: 'project-verification', version: 1,
    operations: ['catalog --json', 'doctor --repo PATH', 'snapshot --repo PATH --base REF',
      'normalize-selection PROPOSAL --repo PATH --out SELECTION [--base REF] [--historical]',
      'validate-selection SELECTION --repo PATH [--base REF] [--historical]',
      'prove --selection SELECTION --repo PATH [--base REF] [--historical] [--evidence-root PATH]',
      'prove --scenario ID --repo PATH [--evidence-root PATH]'],
    artifact_root: 'TARGET/.plans/verifications/{feature_name}/{attempt_id}/',
  };
  const operation = positionals[0];
  if (!operation || !['catalog', 'doctor', 'snapshot', 'normalize-selection', 'validate-selection', 'prove'].includes(operation)) throw new Error('Unknown operation; use --help');
  const needsFile = ['normalize-selection', 'validate-selection'].includes(operation);
  if (positionals.length !== (needsFile ? 2 : 1)) throw new Error('Unexpected or missing positional arguments');
  const allowed: Record<string, string[]> = {
    catalog: ['json'], doctor: ['repo'], snapshot: ['repo', 'base'],
    'normalize-selection': ['repo', 'base', 'historical', 'out'],
    'validate-selection': ['repo', 'base', 'historical'],
    prove: ['repo', 'base', 'historical', 'selection', 'scenario', 'evidence-root'],
  };
  for (const key of Object.keys(values)) if (!allowed[operation].includes(key)) throw new Error(`Unsupported option --${key} for ${operation}`);
  let catalogError: string | undefined;
  const catalog = await loadCatalog().catch(error => {
    if (operation !== 'prove') throw error;
    catalogError = String(error);
    return { version: 1 as const, features: [], gaps: [], catalog_sha256: '0'.repeat(64) };
  });
  if (operation === 'catalog') { validateRunnable(catalog); return catalogSchema.parse(catalog); }
  if (!values.repo) throw new Error('--repo is required');
  const repo = resolve(values.repo);
  if (operation === 'doctor') return doctor(repo);
  if (operation === 'snapshot') {
    if (!values.base) throw new Error('snapshot requires an independent --base');
    return snapshot(repo, values.base);
  }
  if (operation === 'normalize-selection') {
    if (!values.out) throw new Error('--out is required');
    const proposal = await readJson(positionals[1]);
    const selected = normalizeProposal(catalog, proposal, await snapshot(repo, values.base), values.historical);
    validateRunnable(catalog, selected.scenario_ids);
    await writeJson(values.out, selected);
    return selected;
  }
  if (operation === 'validate-selection') return validateSelection(catalog, repo, await readJson(positionals[1]), values.base, values.historical);
  if (Boolean(values.selection) === Boolean(values.scenario)) throw new Error('Use exactly one of --selection or --scenario');
  let selection: Selection | undefined;
  let preflightError: string | undefined = catalogError;
  if (values.selection) {
    try { selection = selectionSchema.parse(await readJson(values.selection)); }
    catch (error) { preflightError = String(error); }
  }
  if (values.scenario && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(values.scenario)) preflightError = 'Unsafe scenario identity';
  const evidence = values['evidence-root'] ?? (values.selection
    ? join(dirname(resolve(values.selection)), 'evidence')
    : join(repo, ARTIFACT_SUBTREE, preflightError ? 'failed-preflight' : (values.scenario ?? 'failed-preflight'), randomUUID(), 'evidence'));
  const result = await prove(catalog, repo, selection?.scenario_ids ?? (values.scenario && !preflightError ? [values.scenario] : []), evidence,
    selection, values.base, { historical: values.historical, selectionPath: values.selection, preflightError });
  process.exitCode = result.ok ? 0 : 1;
  return result;
}
try { console.log(JSON.stringify(await main())); }
catch (error) { console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; }
