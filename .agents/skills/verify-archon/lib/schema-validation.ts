import { readFileSync } from 'node:fs';
import { z } from '@hono/zod-openapi';

/** Zod supports the canonical schemas except their root if/then constraints. */
export function protocolSchema(name: string): z.ZodType {
  if (!['contract', 'catalog', 'gaps', 'snapshot', 'proposal', 'selection', 'result'].includes(name)) throw new Error('Unknown protocol schema');
  const json: z.core.JSONSchema.JSONSchema = JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8'));
  const conditions = (json.allOf ?? []).filter(part => typeof part === 'object' && part.if !== undefined);
  const base = z.fromJSONSchema({ ...json, allOf: (json.allOf ?? []).filter(part => !conditions.includes(part)) });
  const checks = conditions.map(part => {
    if (typeof part !== 'object' || typeof part.if !== 'object' || typeof part.then !== 'object') throw new Error('Unsupported conditional schema');
    return {
      when: z.fromJSONSchema({ ...part.if, $defs: json.$defs }),
      then: z.fromJSONSchema({ ...part.then, $defs: json.$defs }),
    };
  });
  return base.superRefine((value, context): void => {
    for (const check of checks) {
      if (check.when.safeParse(value).success && !check.then.safeParse(value).success) {
        context.addIssue({ code: 'custom', message: 'Canonical conditional constraint failed' });
      }
    }
  });
}
