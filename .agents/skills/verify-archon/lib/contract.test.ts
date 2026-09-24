import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { z } from '@hono/zod-openapi';
import {
  catalogSchema,
  featureSchema,
  gapsSchema,
  snapshotSchema,
  normalizeProposal,
  guardResult,
  digest,
} from './contract';
import { protocolSchema } from './schema-validation';

const vectorSchema = z.object({
  schema_cases: z.array(z.object({ id: z.string(), schema: z.string(), instance: z.unknown() })),
  canonicalization_cases: z.array(z.object({ id: z.string(), canonical_value: z.unknown(), expected_sha256: z.string() })),
  selection_cases: z.array(z.object({
    id: z.string(), catalog: z.unknown(), snapshot: z.unknown(), proposal: z.unknown(),
    request: z.object({ base: z.string(), historical: z.boolean() }),
    expected: z.object({ behavior_ids: z.array(z.string()), scenario_ids: z.array(z.string()), broadened_features: z.array(z.string()) }).optional(),
    expected_failure: z.unknown().optional(),
  })),
  result_cases: z.array(z.object({ id: z.string(), result: z.unknown(), current_context: z.unknown(), expected: z.object({ ok: z.boolean() }) })),
});
const vectors = vectorSchema.parse(JSON.parse(readFileSync(new URL('../conformance.json', import.meta.url), 'utf8')));
const runUi = featureSchema.parse(
  JSON.parse(readFileSync(new URL('../features/run-ui.json', import.meta.url), 'utf8'))
);
const gaps = gapsSchema.parse(
  JSON.parse(readFileSync(new URL('../coverage-gaps.json', import.meta.url), 'utf8'))
);
const visual = z
  .object({
    states: z.array(z.string()),
    criteria: z.array(z.object({ id: z.string(), states: z.array(z.string()) })),
    accepted_differences: z.array(z.string()),
  })
  .parse(JSON.parse(readFileSync(new URL('../visual-config.json', import.meta.url), 'utf8')));

test('live queue behavior retains functional and normative visual proof', (): void => {
  const behavior = runUi.behaviors.find(item => item.id === 'ui.queue-guidance');
  expect(behavior?.scenarios).toEqual(['ui.queue-guidance', 'ui.visual']);
  expect(visual.states).toContain('queue-waiting');
  expect(
    visual.criteria.some(
      criterion => criterion.id === 'queue-anatomy' && criterion.states.includes('queue-waiting')
    )
  ).toBe(true);
  expect(visual.accepted_differences.some(item => /steering dock is excluded/i.test(item))).toBe(
    false
  );
  expect(
    gaps.gaps.some(gap =>
      gap.impact_paths.includes('packages/web/src/components/workflows/ComposerDock.tsx')
    )
  ).toBe(false);
});
for (const item of vectors.schema_cases) {
  test(`canonical schema: ${item.id}`, (): void => {
    expect(protocolSchema(item.schema).safeParse(item.instance).success).toBe(true);
  });
}
for (const item of vectors.canonicalization_cases) {
  test(`canonical digest: ${item.id}`, (): void => { expect(digest(item.canonical_value)).toBe(item.expected_sha256); });
}
for (const item of vectors.selection_cases) {
  test(`selection: ${item.id}`, (): void => {
    const run = (): ReturnType<typeof normalizeProposal> => {
      const current = snapshotSchema.parse(item.snapshot);
      if (current.base_sha !== item.request.base) throw new Error('Independent base differs');
      return normalizeProposal(catalogSchema.parse(item.catalog), item.proposal, current, item.request.historical);
    };
    if (item.expected) expect(run()).toMatchObject(item.expected);
    else expect(run).toThrow();
  });
}
for (const item of vectors.result_cases) {
  test(`production result guard: ${item.id}`, (): void => {
    expect(guardResult(item.result, item.current_context).length === 0).toBe(item.expected.ok);
  });
}
