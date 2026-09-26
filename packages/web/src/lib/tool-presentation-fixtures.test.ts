/**
 * Cross-surface semantic parity: one JSON fixture set, read from a path
 * neither this package nor `@archon/workflows` owns, proves the Web
 * presenter and the backend formatter agree on family, headline, outcome
 * glyph, and badge order for the same event. Node Room, RunStream, and Chat
 * all resolve through `toolRowPresentation` directly, so asserting it here
 * covers all three; `tool-formatter.fixtures.test.ts` in `@archon/workflows`
 * proves the independent backend copy against the same fixtures.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  toolRowPresentation,
  type ToolFamily,
  type ToolHeadlineKind,
  type ToolOutcome,
  type ToolRowBadgeKind,
  type ToolStatusGlyph,
} from './tool-presentation';

const TOOL_FAMILIES: readonly ToolFamily[] = [
  'shell',
  'file',
  'search',
  'glob',
  'code',
  'todo',
  'task',
  'web',
  'generic',
];
const HEADLINE_KINDS: readonly ToolHeadlineKind[] = ['path', 'text'];
const STATUS_GLYPHS: readonly ToolStatusGlyph[] = ['✓', '✕', '◐', '⚠', '–'];
const BADGE_KINDS: readonly ToolRowBadgeKind[] = [
  'state',
  'exit',
  'duration',
  'count',
  'language',
  'operation',
  'output-state',
  'diff',
  'placeholder',
];

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

interface FixtureBadge {
  kind: ToolRowBadgeKind;
  text: string;
}

interface FixtureCase {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  facts: { outcome: ToolOutcome; exitCode?: number; durationMs?: number };
  expected: {
    family: ToolFamily;
    label: string;
    headline: string;
    headlineKind: ToolHeadlineKind;
    glyph: ToolStatusGlyph;
    badges: FixtureBadge[];
  };
}

function isFixtureBadge(value: unknown): value is FixtureBadge {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return isOneOf(BADGE_KINDS, record.kind) && typeof record.text === 'string';
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
    isOneOf(TOOL_FAMILIES, e.family) &&
    typeof e.label === 'string' &&
    typeof e.headline === 'string' &&
    isOneOf(HEADLINE_KINDS, e.headlineKind) &&
    isOneOf(STATUS_GLYPHS, e.glyph) &&
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

describe('cross-surface fixture parity — Web presenter', () => {
  const fixtures = loadFixtures();

  test('the fixture set is non-empty and covers every declared family', () => {
    const families = new Set(fixtures.map(f => f.expected.family));
    for (const family of TOOL_FAMILIES) {
      expect(families.has(family)).toBe(true);
    }
  });

  for (const fixture of fixtures) {
    test(`${fixture.id}: family, label, headline, outcome, and badges match the fixture's expectation`, () => {
      const presentation = toolRowPresentation(
        { name: fixture.name, input: fixture.input, output: fixture.output },
        fixture.facts
      );
      expect(presentation.family).toBe(fixture.expected.family);
      expect(presentation.label).toBe(fixture.expected.label);
      expect(presentation.headline).toBe(fixture.expected.headline);
      expect(presentation.headlineKind).toBe(fixture.expected.headlineKind);
      expect(presentation.glyph).toBe(fixture.expected.glyph);
      expect(presentation.badges.map(b => ({ kind: b.kind, text: b.text }))).toEqual(
        fixture.expected.badges
      );
    });
  }
});
