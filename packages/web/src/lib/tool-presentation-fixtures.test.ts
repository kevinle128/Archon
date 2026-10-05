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
import { buildAgentHistory } from './agent-history';
import {
  toolRowPresentation,
  type ToolFamily,
  type ToolHeadlineKind,
  type ToolOutcome,
  type ToolRowBadgeKind,
  type ToolStatusGlyph,
} from './tool-presentation';
import { chatToolOutcome } from '../components/chat/ToolCallCard';
import type { NodeMessageRow } from './node-message-pages';
import type { ToolCallDisplay } from './types';

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

/**
 * The raw, provider-reported outcome string that would lead EITHER surface's
 * own outcome derivation to the fixture's already-resolved `facts.outcome` —
 * both surfaces consume the same three-value vocabulary (`success` / `error`
 * / `interrupted` / `unknown`) before turning it into a `ToolOutcome`. A
 * `running` fact has no raw outcome of its own — each surface derives it from
 * its own liveness flag (a pending row / `isRunning`) instead, checked before
 * either even looks at a recorded outcome.
 */
function rawOutcomeFor(outcome: ToolOutcome): 'success' | 'error' | 'interrupted' | 'unknown' {
  switch (outcome) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'error';
    case 'interrupted':
      return 'interrupted';
    case 'unknown':
    case 'running':
      return 'unknown';
  }
}

function nodeRoomOutcome(fixture: FixtureCase): ToolOutcome {
  const toolUseId = fixture.id;
  const rows: NodeMessageRow[] = [
    {
      id: `${fixture.id}-call`,
      seq: 1,
      kind: 'tool',
      payload: { name: fixture.name, id: toolUseId, input: fixture.input },
      created_at: '2026-09-08T00:00:00.000Z',
      metadata: { tool_phase: 'call' },
    },
  ];
  // A 'running' fixture has no result row at all — the pending call alone
  // is what the node room's own derivation reads as still in flight.
  if (fixture.facts.outcome !== 'running') {
    rows.push({
      id: `${fixture.id}-result`,
      seq: 2,
      kind: 'tool',
      payload: { name: fixture.name, id: toolUseId, output: fixture.output ?? undefined },
      created_at: '2026-09-08T00:00:00.000Z',
      metadata: {
        tool_phase: 'result',
        outcome: rawOutcomeFor(fixture.facts.outcome),
        ...(fixture.facts.exitCode !== undefined ? { exit_code: fixture.facts.exitCode } : {}),
      },
    });
  }
  const { items } = buildAgentHistory({ nodeId: 'review', nowMs: Date.now(), events: [], rows });
  const tool = items.find(item => item.kind === 'tool');
  if (tool?.kind !== 'tool') throw new Error(`expected a tool item for fixture ${fixture.id}`);
  return tool.outcome;
}

function chatOutcome(fixture: FixtureCase): ToolOutcome {
  const isRunning = fixture.facts.outcome === 'running';
  const tool: ToolCallDisplay = {
    id: fixture.id,
    name: fixture.name,
    input: (fixture.input as Record<string, unknown>) ?? {},
    startedAt: Date.now(),
    isExpanded: false,
    ...(isRunning
      ? {}
      : {
          output:
            typeof fixture.output === 'string' ? fixture.output : JSON.stringify(fixture.output),
          duration: fixture.facts.durationMs ?? 0,
          outcome: rawOutcomeFor(fixture.facts.outcome),
          ...(fixture.facts.exitCode !== undefined ? { exitCode: fixture.facts.exitCode } : {}),
        }),
  };
  return chatToolOutcome(tool, isRunning);
}

describe('cross-surface outcome-derivation parity — Chat vs Node Room', () => {
  const fixtures = loadFixtures();

  for (const fixture of fixtures) {
    test(`${fixture.id}: Chat and Node Room derive the same outcome from equivalent raw data`, () => {
      const nodeRoom = nodeRoomOutcome(fixture);
      const chat = chatOutcome(fixture);
      // Both surfaces must agree with each other, and with the fixture's own
      // expectation — not just with each other, in case both silently made
      // the same wrong call.
      expect(nodeRoom).toBe(fixture.facts.outcome);
      expect(chat).toBe(fixture.facts.outcome);
      expect(chat).toBe(nodeRoom);
    });
  }
});
