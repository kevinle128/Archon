import { createHash } from 'node:crypto';
import { z } from '@hono/zod-openapi';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const relativePathSchema = z.string().min(1).refine(value =>
  !/^[A-Za-z]:|^\/|[\\\0*?[]|\/\//.test(value) &&
  !value.split('/').some(part => part === '.' || part === '..'), 'Unsafe relative path');
const strings = z.array(z.string().min(1));
const unique = (values: string[]): boolean => new Set(values).size === values.length;
const ids = z.array(id).refine(unique, 'Duplicate identity');
const paths = z.array(relativePathSchema).refine(unique, 'Duplicate path');
const runnerSchema = z.object({ kind: id, id }).strict();
export const scenarioSchema = z.object({
  id, runner: runnerSchema, prerequisites: strings,
  proof_obligations: strings.min(1),
}).strict();
const behaviorSchema = z.object({
  id, description: z.string().min(1), priority: z.number().int().nonnegative(),
  impact_paths: paths.refine(value => value.length > 0), scenarios: ids.refine(value => value.length > 0),
}).strict();
export const featureSchema = z.object({
  id, description: z.string().min(1), impact_paths: paths.refine(value => value.length > 0),
  behaviors: z.array(behaviorSchema).min(1), scenarios: z.array(scenarioSchema).min(1),
}).strict();
const gapSchema = z.object({
  id, description: z.string().min(1), impact_paths: paths, reason: z.string().min(1),
}).strict();
export const gapsSchema = z.object({ version: z.literal(1), gaps: z.array(gapSchema) }).strict();
export const catalogSchema = z.object({
  version: z.literal(1), features: z.array(featureSchema).min(1),
  gaps: z.array(gapSchema), catalog_sha256: hash,
}).strict();
export const snapshotSchema = z.object({
  version: z.literal(1), base_sha: sha, head_sha: sha, changed_paths: paths, dirty: z.boolean(),
}).strict();
export const proposalSchema = z.object({
  version: z.literal(1), base_sha: sha.optional(), head_sha: sha.optional(), changed_paths: paths.optional(),
  affected_behaviors: z.array(z.object({
    id, confidence: z.enum(['high', 'medium', 'low']), rationale: z.string().min(1),
  }).strict()).min(1).refine(values => unique(values.map(value => value.id)), 'Duplicate behavior'),
  coverage_gaps: ids,
}).strict();
export const selectionSchema = z.object({
  version: z.literal(1), proposal: proposalSchema, catalog_sha256: hash,
  behavior_ids: ids.refine(value => value.length > 0),
  scenario_ids: ids.refine(value => value.length > 0), broadened_features: ids,
}).strict();
export const scenarioResultSchema = z.object({
  id, status: z.enum(['passed', 'failed', 'flaky', 'skipped', 'missing', 'unsupported']),
  errors: strings,
  attachments: z.array(z.object({ name: z.string().min(1), path: relativePathSchema }).strict()),
}).strict();
export const resultSchema = z.object({
  version: z.literal(1), run_id: id, mode: z.enum(['selection', 'scenario-debug']),
  repo: z.string().min(1), product: snapshotSchema.nullable(),
  catalog_sha256: hash.nullable(), selection_sha256: hash.nullable(), tooling_sha256: hash.nullable(),
  behavior_ids: ids, scenario_ids: ids, scenarios: z.array(scenarioResultSchema),
  errors: strings, ok: z.boolean(), verdict: z.enum(['PASS', 'FAIL']), evidence_dir: z.string().min(1),
}).strict();
export const contextSchema = z.object({
  run_id: id, repo: z.string(), evidence_dir: z.string(),
  required_behavior_ids: ids, required_scenario_ids: ids,
  product: snapshotSchema.nullable(), catalog_sha256: hash.nullable(),
  selection_sha256: hash.nullable(), tooling_sha256: hash.nullable(), attachment_inventory: paths,
}).strict();
export type Catalog = z.infer<typeof catalogSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type Selection = z.infer<typeof selectionSchema>;
export type ProofResult = z.infer<typeof resultSchema>;
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;
export type ProofContext = z.infer<typeof contextSchema>;

export function codePointOrder(a: string, b: string): number {
  const left = Array.from(a, char => char.codePointAt(0) ?? 0);
  const right = Array.from(b, char => char.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}
export function sorted(values: Iterable<string>): string[] {
  return [...values].sort(codePointOrder);
}
const setKeys = new Set(['impact_paths', 'changed_paths', 'behavior_ids', 'scenario_ids',
  'broadened_features', 'coverage_gaps', 'prerequisites', 'proof_obligations']);
export function canonical(value: unknown, key = ''): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    const isSet = setKeys.has(key) || (key === 'scenarios' && value.every(item => typeof item === 'string'));
    const items: unknown[] = isSet ? sorted(z.array(z.string()).parse(value)) : value;
    if (isSet && !unique(z.array(z.string()).parse(items))) throw new Error(`Duplicate ${key}`);
    return '[' + items.map(item => canonical(item)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + sorted(Object.keys(record)).map(name => JSON.stringify(name) + ':' + canonical(record[name], name)).join(',') + '}';
  }
  throw new Error('Canonical JSON rejects non-JSON values');
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function assertUnique(values: string[], kind: string): void {
  if (!unique(values)) throw new Error(`Duplicate ${kind} identity`);
}
export function validateCatalog(catalog: Catalog): void {
  const features = catalog.features;
  const behaviors = features.flatMap(feature => feature.behaviors);
  const scenarios = features.flatMap(feature => feature.scenarios);
  assertUnique(features.map(item => item.id), 'feature');
  assertUnique(behaviors.map(item => item.id), 'behavior');
  assertUnique(scenarios.map(item => item.id), 'scenario');
  assertUnique(catalog.gaps.map(item => item.id), 'gap');
  assertUnique([...behaviors, ...catalog.gaps].map(item => item.id), 'behavior/gap');
  for (const behavior of behaviors) {
    for (const scenario of behavior.scenarios) {
      if (!scenarios.some(item => item.id === scenario)) throw new Error(`Unknown scenario ${scenario}`);
    }
  }
}
export function normalizeProposal(
  catalog: Catalog, input: unknown,
): Selection {
  validateCatalog(catalog);
  const proposal = proposalSchema.parse(input);
  const behaviors = catalog.features.flatMap(feature => feature.behaviors);
  for (const gap of proposal.coverage_gaps) {
    if (!catalog.gaps.some(item => item.id === gap)) throw new Error(`Unknown gap ${gap}`);
  }
  const gaps = catalog.gaps.filter(gap => proposal.coverage_gaps.includes(gap.id));
  if (gaps.length) throw new Error(`Coverage gap: ${gaps.map(gap => gap.id).join(', ')}`);
  const selected = new Set<string>();
  const broadened = new Set<string>();
  for (const item of proposal.affected_behaviors) {
    if (!behaviors.some(behavior => behavior.id === item.id)) throw new Error(`Unknown behavior ${item.id}`);
    selected.add(item.id);
  }
  for (const feature of catalog.features) {
    const proposals = proposal.affected_behaviors.filter(item => feature.behaviors.some(behavior => behavior.id === item.id));
    const expand = proposals.some(item => item.confidence !== 'high');
    if (expand) {
      broadened.add(feature.id);
      feature.behaviors.forEach(behavior => selected.add(behavior.id));
    }
  }
  return selectionSchema.parse({ version: 1, proposal, catalog_sha256: catalog.catalog_sha256,
    behavior_ids: sorted(selected),
    scenario_ids: sorted(new Set(behaviors.filter(item => selected.has(item.id)).flatMap(item => item.scenarios))),
    broadened_features: sorted(broadened),
  });
}

/** The public runner and conformance vectors use this same final PASS guard. */
export function guardResult(input: unknown, contextInput: unknown): string[] {
  const parsed = resultSchema.safeParse(input);
  const context = contextSchema.parse(contextInput);
  if (!parsed.success) return ['Missing or malformed current result'];
  const result = parsed.data;
  const errors = [...result.errors];
  if (!result.ok || result.verdict !== 'PASS') errors.push('Executable proof did not pass');
  for (const key of ['run_id', 'repo', 'evidence_dir', 'catalog_sha256', 'selection_sha256', 'tooling_sha256'] as const) {
    if (result[key] !== context[key]) errors.push(`Stale or mismatched ${key}`);
  }
  if (!result.catalog_sha256 || !result.tooling_sha256) errors.push('Missing proof identity');
  if (result.mode === 'selection' && !result.selection_sha256) errors.push('Selection proof requires its target list');
  if (digest(sorted(result.behavior_ids)) !== digest(sorted(context.required_behavior_ids))) errors.push('Behavior set mismatch');
  if (digest(sorted(result.scenario_ids)) !== digest(sorted(context.required_scenario_ids))) errors.push('Scenario set mismatch');
  if (result.scenarios.length !== context.required_scenario_ids.length) errors.push('Incomplete scenario count');
  const attachmentNames: string[] = [];
  for (const scenarioId of context.required_scenario_ids) {
    const runs = result.scenarios.filter(item => item.id === scenarioId);
    if (runs.length !== 1) { errors.push(`Missing or duplicate scenario ${scenarioId}`); continue; }
    const run = runs[0];
    if (run.status !== 'passed' || run.errors.length) errors.push(`${scenarioId}: ${run.status}: ${run.errors.join('; ')}`);
    if (!run.attachments.length) errors.push(`${scenarioId}: missing evidence`);
    for (const attachment of run.attachments) {
      attachmentNames.push(attachment.name);
      if (!context.attachment_inventory.includes(attachment.path)) errors.push(`Missing attachment ${attachment.path}`);
    }
  }
  if (!unique(attachmentNames)) errors.push('Duplicate attachment identity');
  return errors;
}
