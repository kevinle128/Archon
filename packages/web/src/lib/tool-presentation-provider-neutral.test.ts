/**
 * Provider-neutrality guard for the shared tool presenter. `agent-history.ts`
 * and `tool-presentation.ts` derive every glyph, badge, and outcome from
 * normalized data the executor already wrote — never from which provider
 * produced a row. A registered provider id appearing as a quoted string
 * literal in either file would be exactly that kind of branch, so this test
 * fails loudly if one ever creeps in.
 */
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Every id a provider is registered under (built-in and community), plus the
 * deterministic test provider. Kept as a literal list rather than importing
 * the registry: importing `@archon/providers` would pull SDK deps into a
 * `@archon/web` test and the ids change rarely enough that a mismatch would
 * surface immediately in `registry.test.ts`.
 */
const REGISTERED_PROVIDER_IDS = [
  'claude',
  'codex',
  'grok',
  'pi',
  'copilot',
  'opencode',
  'qodercli',
  'omp',
  'deepseek',
  'devin',
  'e2e-fake',
] as const;

const PRESENTER_FILES = ['agent-history.ts', 'tool-presentation.ts'] as const;

/** Matches a provider id as a complete quoted string literal, not a substring. */
function quotedLiteralPattern(id: string): RegExp {
  return new RegExp(`['"\`]${id}['"\`]`);
}

describe('tool presenter provider neutrality', () => {
  for (const file of PRESENTER_FILES) {
    test(`${file} contains no registered provider id as a string literal`, async () => {
      const path = join(import.meta.dir, file);
      const source = await readFile(path, 'utf-8');

      for (const id of REGISTERED_PROVIDER_IDS) {
        expect(quotedLiteralPattern(id).test(source)).toBe(false);
      }
    });
  }
});
