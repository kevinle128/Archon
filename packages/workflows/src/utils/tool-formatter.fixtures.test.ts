/**
 * Cross-surface semantic parity, backend half. The same JSON fixture set
 * `packages/web/src/lib/tool-presentation-fixtures.test.ts` reads proves this
 * independent backend resolver agrees with the Web presenter on family,
 * headline, outcome glyph, and badge order — without either package
 * importing the other. See `tool-formatter.ts`'s module docblock.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveToolPresentationSummary, type ToolOutcome } from './tool-formatter';

interface FixtureBadge {
  kind: string;
  text: string;
}

interface FixtureCase {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  facts: { outcome: ToolOutcome; exitCode?: number; durationMs?: number };
  expected: {
    family: string;
    label: string;
    headline: string;
    glyph: string;
    badges: FixtureBadge[];
  };
}

function isFixtureBadge(value: unknown): value is FixtureBadge {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === 'string' && typeof record.text === 'string';
}

/** Validates the loaded JSON has the shape this test relies on — a fixture file is an external input, not a trusted module. */
function isFixtureCase(value: unknown): value is FixtureCase {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return false;
  const facts = record.facts;
  if (
    typeof facts !== 'object' ||
    facts === null ||
    typeof (facts as { outcome?: unknown }).outcome !== 'string'
  ) {
    return false;
  }
  const expected = record.expected;
  if (typeof expected !== 'object' || expected === null) return false;
  const e = expected as Record<string, unknown>;
  return (
    typeof e.family === 'string' &&
    typeof e.label === 'string' &&
    typeof e.headline === 'string' &&
    typeof e.glyph === 'string' &&
    Array.isArray(e.badges) &&
    e.badges.every(isFixtureBadge)
  );
}

function loadFixtures(): FixtureCase[] {
  const path = join(import.meta.dir, '../../../../fixtures/tool-presentation/cases.json');
  const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isFixtureCase)) {
    throw new Error(`malformed or empty tool-presentation fixture set at ${path}`);
  }
  return raw;
}

describe('cross-surface fixture parity — backend formatter', () => {
  const fixtures = loadFixtures();

  test('the fixture set is non-empty and covers every declared family', () => {
    const families = new Set(fixtures.map(f => f.expected.family));
    for (const family of [
      'shell',
      'file',
      'search',
      'glob',
      'code',
      'todo',
      'task',
      'web',
      'generic',
    ]) {
      expect(families.has(family)).toBe(true);
    }
  });

  for (const fixture of fixtures) {
    test(`${fixture.id}: family, label, headline, outcome, and badges match the fixture's expectation`, () => {
      const summary = resolveToolPresentationSummary(
        { name: fixture.name, input: fixture.input, output: fixture.output },
        fixture.facts
      );
      expect(summary.family).toBe(fixture.expected.family);
      expect(summary.label).toBe(fixture.expected.label);
      expect(summary.headline).toBe(fixture.expected.headline);
      expect(summary.glyph).toBe(fixture.expected.glyph);
      expect(summary.badges).toEqual(fixture.expected.badges);
    });
  }
});
