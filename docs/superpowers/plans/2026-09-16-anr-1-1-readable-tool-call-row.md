# ANR Story 1.1 — Scan a Tool Call as One Readable Row — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each always-open tool-call JSON card with one scannable disclosure row on both the Legacy and Console node rooms.

**Architecture:** A new React-free resolver in `packages/web/src/lib/tool-presentation.ts` classifies provider payloads and produces all payload-derived collapsed-row facts.
`packages/web/src/lib/agent-history.ts` attaches that presentation, carries the exit code, owns the complete ordered badge and status text projection, and folds an immediately following `interrupted` lifecycle row into the preceding tool item.
The two shells retain separate JSX but consume the same render-neutral data and use native `<details>/<summary>` disclosure semantics.

**Tech Stack:** Strict TypeScript, React 19, Tailwind v4, existing CSS custom properties, Bun test, `renderToStaticMarkup`, and happy-dom.

**Issue:** `https://github.com/anhle128/Archon/issues/174`.

**Spec:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` Story 1.1, `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`, `_bmad-output/specs/spec-agent-node-room/test-plan.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`, `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md`, and `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`.

## Global Constraints

- Keep this change inside `@archon/web`; do not add a schema, migration, server route, backend formatter change, dependency, feature flag, environment variable, or deployment step.
- Do not import `@archon/workflows` from `@archon/web`; web wire types continue to come through `packages/web/src/lib/api.generated.d.ts` and `packages/web/src/lib/api.ts`.
- Keep Console imports within the boundary enforced by `packages/web/src/experiments/console/console-isolation.test.ts`; Console must not import Legacy components, stores, contexts, routes, hooks, or `@tanstack/react-query`.
- Use strict TypeScript with complete annotations, no unjustified `any`, and zero ESLint warnings.
- Use the sent tool name for a chip only when it is one whitespace-free token of at most 24 characters; otherwise use the resolved family name.
- Match normalized tool names exactly after case-folding and removing `_` and `-`; never match aliases by substring.
- Keep the collapsed summary free of raw serialized JSON; the existing Input and Output blocks remain only inside the disclosure body until Stories 1.2 and 1.3 replace them with the Raw toggle and family-shaped bodies.
- Make status understandable without colour through the literal glyphs `✓`, `✕`, `◐`, `⚠`, and `–`; colour only reinforces the glyph.
- Use `--node-bash` for shell and code, `--node-command` for file and web, `--node-prompt` for search and glob, `--node-approval` for todo and task, and `--text-secondary` for generic.
- Use `--success`, `--error`, `--warning`, and `--text-secondary` for status, with `--accent-bright` for Legacy running and `--running` for Console running.
- Preserve the full headline text in the DOM and accessible name; path elision is a visual two-span middle elision and text elision is visual end truncation.
- Use native `<details>/<summary>`; the whole summary is the toggle, and a manual reader choice must survive live re-renders.
- Run focused tests with `bun test --cwd packages/web src/lib/...`, `src/components/...`, or `src/experiments/console/...`; never run `bun test` from the repository root.
- Run `bun run validate` before the final commit.
- Resolve conflicts in this order: Story 1.1 acceptance criteria, the tool-presentation contract plus adopted architecture decisions, the test plan, then finalized DESIGN and EXPERIENCE; brainstorm HTML imports and mockups do not override finalized artifacts.

---

## Scope and Non-Goals

This plan implements only Story 1.1 and the Story 1.1 read-side seam needed by the future interrupt story.

In scope:

- Resolve every tool call to `family`, `label`, `chipAriaLabel`, `headline`, `headlineKind`, and payload-derived badges.
- Produce the complete status and ordered badge view in the shared core.
- Carry `exitCode` on tool history items.
- Fold a lifecycle item whose exact state is `interrupted` into an immediately preceding tool item.
- Render the same one-line disclosure anatomy on Legacy and Console.
- Seed the five initial disclosure states from a table and auto-open an untouched row that changes to `failed` during polling.
- Preserve the current full-output loader inside the expanded disclosure.

Deferred:

- Story 1.2 owns the per-card Raw toggle and the rule that Raw is the only final JSON surface.
- Story 1.3 owns terminal, diff, matches, paths, code, file-preview, web, and generic expanded body arms.
- Story 1.4 owns inline diffs and the `git-hunk-adapter.ts` move.
- Story 1.5 owns `TodoPhase[]`, the pinned todo strip, and the widened `buildAgentHistory()` return type.
- Story 1.6 owns `TaskSubtask[]` and subtask cards.
- Story 1.7 owns occurrence grouping and the loop-iteration selector.
- The polite live region, transcript stick-to-bottom behavior, todo rendering, and loop navigation remain with their assigned later stories.

Do not add a partial `body` union or render a second generic or terminal body in this story.
The expanded region temporarily retains the existing Input and Output presentation so Story 1.1 remains independently inspectable without implementing later capabilities early.

## File Structure

- Create `packages/web/src/lib/tool-presentation.ts` for the pure resolver, chip-token mapping, and headline split helper.
- Create `packages/web/src/lib/tool-presentation.test.ts` for resolver classification, display, and safe-degradation tests.
- Modify `packages/web/src/lib/agent-history.ts` to attach `ToolPresentation`, carry `exitCode`, project status and badges, and fold interrupted lifecycle rows.
- Modify `packages/web/src/lib/agent-history.test.ts` for the projection, expansion table, badge order, and interrupted fold.
- Modify `packages/web/src/components/workflows/NodeRoom.tsx` for the Legacy native disclosure row.
- Modify `packages/web/src/components/workflows/NodeRoom.test.tsx` for Legacy initial-state, summary-content, accessibility, and live-transition coverage.
- Modify `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` for the Console native disclosure row.
- Modify `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` for the equivalent Console coverage.
- Modify `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` before the final gate and commit its `done` value only after all Story 1.1 checks pass.
- Create `_bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md` with the exact test results and acceptance-criterion map gathered during Task 6.

## Settled Decisions

- Treat `state === 'interrupted'` as the exact lifecycle marker; the Story 1.1 acceptance criterion and the merged ANR contract use that literal.
- Fall back to the `generic` family label when `server · tool` for an MCP name exceeds 24 characters.
- Show `exit N` only for a non-zero finite exit code.
- Order badges as payload facts, non-zero exit code, output-state marker, then duration.
- Mark duration as the only droppable badge; semantic facts stay fixed while duration may shrink out under pressure.
- Treat missing input (`undefined`) and an empty plain object as the Codex name-only shell path.
- Treat null, arrays, primitives, invalid names, and invalid records as malformed input and resolve them to a safe generic row.
- Build the generic collapsed headline from at most three scalar top-level `key: value` pairs; ignore nested objects and arrays in the summary so `{…}` and `[n]` never enter the collapsed row.
- Keep nested placeholders out of Story 1.1 entirely because the generic expanded body belongs to Story 1.3.
- Keep `code` on `--node-bash`; `DESIGN.md:423-425` records the owner decision after discovering that `--node-script` is Console-only.

## Current Repository Facts

- `AgentHistoryItem` currently exposes `context` and discards the exit code after outcome derivation in `packages/web/src/lib/agent-history.ts`.
- The only production readers of `item.context` are `packages/web/src/components/workflows/NodeRoom.tsx` and `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`.
- The Legacy test constructs a tool `AgentHistoryItem` literal in `packages/web/src/components/workflows/NodeRoom.test.tsx`.
- Console tests feed wire rows through `buildAgentHistory()` and use top-level `metadata`, matching `components['schemas']['WorkflowNodeMessage']`.
- The current Console test at `ConsoleNodeRoom.test.tsx:1002` expects an open successful or unknown tool card and must be updated to the new disclosure contract.
- Closed native `<details>` content remains in the DOM and in `textContent`; tests must inspect `details.open` and the `<summary>` text rather than assert that body text is absent from the DOM.

---

## Task 1: Add the resolver classification tracer bullet

**Files:**

- Create: `packages/web/src/lib/tool-presentation.ts`
- Create: `packages/web/src/lib/tool-presentation.test.ts`

**Interfaces:**

- Consumes: no React or `@archon/*` imports.
- Produces:

```ts
export type ToolFamily =
  | 'shell'
  | 'file'
  | 'search'
  | 'glob'
  | 'code'
  | 'todo'
  | 'task'
  | 'web'
  | 'generic';

export interface ToolPresentationInput {
  name: string;
  input: unknown;
  output: unknown;
}

export interface ToolPresentation {
  family: ToolFamily;
  label: string;
  chipAriaLabel: string;
  headline: string;
  headlineKind: 'path' | 'text';
  badges: string[];
}

export function toolPresentation(input: ToolPresentationInput): ToolPresentation;
```

- [ ] **Step 1: Write the failing family-resolution table**

Create `packages/web/src/lib/tool-presentation.test.ts` with a table that covers every Tier 1 alias plus the provider-specific traps.

```ts
import { describe, expect, test } from 'bun:test';

import { toolPresentation, type ToolFamily } from './tool-presentation';

interface FamilyCase {
  name: string;
  input: unknown;
  family: ToolFamily;
}

const FAMILY_CASES: readonly FamilyCase[] = [
  ...['Bash', 'shell', 'run', 'command', 'execute', 'run_terminal_command'].map(name => ({
    name,
    input: { command: 'bun test' },
    family: 'shell' as const,
  })),
  ...[
    'edit',
    'write',
    'create',
    'str_replace',
    'apply_patch',
    'notebook_edit',
    'search_replace',
    'delete',
    'read',
    'view',
    'cat',
    'open',
    'read_file',
  ].map(name => ({ name, input: { file_path: 'a.ts' }, family: 'file' as const })),
  ...['grep', 'search', 'rg', 'search_tool'].map(name => ({
    name,
    input: { pattern: 'needle' },
    family: 'search' as const,
  })),
  ...['glob', 'find', 'ls', 'list', 'list_dir'].map(name => ({
    name,
    input: { path: 'packages/web/src' },
    family: 'glob' as const,
  })),
  ...['eval', 'run_code', 'execute code'].map(name => ({
    name,
    input: { code: '1 + 1', language: 'javascript' },
    family: 'code' as const,
  })),
  ...['todo', 'todo_write', 'plan'].map(name => ({ name, input: {}, family: 'todo' as const })),
  ...['task', 'agent', 'subagent', 'dispatch'].map(name => ({
    name,
    input: {},
    family: 'task' as const,
  })),
  ...['web_fetch', 'web_search', 'fetch', 'browse'].map(name => ({
    name,
    input: { url: 'https://archon.diy' },
    family: 'web' as const,
  })),
];

describe('toolPresentation family resolution', () => {
  test('matches every declared Tier 1 alias exactly', () => {
    for (const fixture of FAMILY_CASES) {
      expect(toolPresentation({ ...fixture, output: undefined }).family).toBe(fixture.family);
    }
  });

  test('uses input keys when the name is unknown', () => {
    expect(toolPresentation({ name: 'mystery', input: { target_file: 'x.ts' }, output: undefined }).family).toBe('file');
    expect(toolPresentation({ name: 'mystery', input: { old_str: 'a', new_str: 'b' }, output: undefined }).family).toBe('file');
    expect(toolPresentation({ name: 'mystery', input: { old_string: 'a', new_string: 'b' }, output: undefined }).family).toBe('file');
  });

  test('never mistakes search_replace for a search tool', () => {
    expect(toolPresentation({ name: 'search_replace', input: { old_string: 'a', new_string: 'b' }, output: undefined }).family).toBe('file');
  });

  test('headlines Claude glob with pattern and OMP glob with path', () => {
    const claude = toolPresentation({ name: 'Glob', input: { pattern: '**/*.tsx', path: 'packages/web' }, output: undefined });
    const omp = toolPresentation({ name: 'glob', input: { path: 'packages/web/src' }, output: undefined });
    expect(claude).toMatchObject({ family: 'glob', headline: '**/*.tsx', headlineKind: 'path' });
    expect(claude.headline).not.toBe('packages/web');
    expect(omp).toMatchObject({ family: 'glob', headline: 'packages/web/src', headlineKind: 'path' });
  });

  test('routes malformed inputs and invalid names to generic without throwing', () => {
    for (const input of [null, [], 'bad', 3]) {
      expect(toolPresentation({ name: 'mystery', input, output: undefined }).family).toBe('generic');
    }
    expect(() => toolPresentation({ name: 123 as unknown as string, input: {}, output: undefined })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the resolver test and verify RED**

Run: `bun test --cwd packages/web src/lib/tool-presentation.test.ts`

Expected: FAIL because `./tool-presentation` does not exist.

- [ ] **Step 3: Implement the exact ordered resolver skeleton**

Create `packages/web/src/lib/tool-presentation.ts` with the interfaces above and these exact alias and key priorities.

```ts
const FAMILY_ALIASES: readonly (readonly [ToolFamily, readonly string[]])[] = [
  ['shell', ['bash', 'shell', 'run', 'command', 'execute', 'runterminalcommand']],
  ['file', ['edit', 'write', 'create', 'strreplace', 'applypatch', 'notebookedit', 'searchreplace', 'delete', 'read', 'view', 'cat', 'open', 'readfile']],
  ['search', ['grep', 'search', 'rg', 'searchtool']],
  ['glob', ['glob', 'find', 'ls', 'list', 'listdir']],
  ['code', ['eval', 'runcode', 'execute code', 'executecode']],
  ['todo', ['todo', 'todowrite', 'plan']],
  ['task', ['task', 'agent', 'subagent', 'dispatch']],
  ['web', ['webfetch', 'websearch', 'fetch', 'browse']],
];

const COMMAND_KEYS = ['command', 'cmd', 'script'] as const;
const PATH_KEYS = ['file_path', 'path', 'target_file', 'file', 'filename', 'notebook_path'] as const;
const PATTERN_KEYS = ['pattern', 'query', 'regex', 'search'] as const;
const URL_KEYS = ['url', 'uri'] as const;
const BEFORE_AFTER_KEYS = [
  ['old_string', 'new_string'],
  ['old_str', 'new_str'],
  ['content', 'new_content'],
] as const;
```

Reject an invalid name or a non-`undefined` input that is not a plain object to the generic path before alias resolution.
Implement valid resolution in this order: Tier 1 alias, code pair, command key, path key, pattern key, URL key, before/after pair, name-only Codex, then generic.
For a Tier 1 `glob`, choose `pattern` before `path` for the headline.
For `file`, choose the first string path key and fall back to the sent name.
For `search`, choose the first string pattern key.
For `web`, choose the first string URL key.
For `code`, choose the first non-empty source line and emit the string `language` as the first payload badge.
For `todo`, `task`, and unresolved generic rows, initially use the sent name as the headline.
Set `headlineKind` to `path` only for file and glob and to `text` for every other family.

- [ ] **Step 4: Run the resolver test and verify GREEN**

Run: `bun test --cwd packages/web src/lib/tool-presentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the classification tracer bullet**

```bash
git add packages/web/src/lib/tool-presentation.ts packages/web/src/lib/tool-presentation.test.ts
git commit -m "feat(web): classify tool calls for readable rows"
```

---

## Task 2: Complete chip, headline, and safe-degradation behavior

**Files:**

- Modify: `packages/web/src/lib/tool-presentation.ts`
- Modify: `packages/web/src/lib/tool-presentation.test.ts`

**Interfaces:**

- Consumes: the Task 1 resolver.
- Produces:

```ts
export const FAMILY_CHIP_TOKEN: Record<ToolFamily, string>;
export type ElidedHeadline =
  | { kind: 'path'; head: string; tail: string }
  | { kind: 'text'; text: string };
export function elideHeadline(headline: string, headlineKind: 'path' | 'text'): ElidedHeadline;
```

- [ ] **Step 1: Add failing chip, MCP, shell-headline, code, and elision tests**

Add focused tests for these exact results.

```ts
test('keeps a short sent name and falls back for whitespace or over 24 characters', () => {
  expect(toolPresentation({ name: 'read_file', input: { path: 'a.ts' }, output: undefined }).label).toBe('read_file');
  expect(toolPresentation({ name: '🚀run', input: {}, output: undefined }).label).toBe('🚀run');
  expect(toolPresentation({ name: 'npm test', input: undefined, output: undefined }).label).toBe('shell');
  expect(toolPresentation({ name: 'x'.repeat(25), input: {}, output: undefined }).label).toBe('shell');
  for (const fixture of FAMILY_CASES) {
    expect(toolPresentation({ ...fixture, output: undefined }).label.length).toBeLessThanOrEqual(24);
  }
});

test('formats MCP names without violating the chip cap', () => {
  expect(toolPresentation({ name: 'mcp__server__tool', input: {}, output: undefined })).toMatchObject({
    family: 'generic',
    label: 'server · tool',
    headline: 'server · tool',
  });
  expect(toolPresentation({ name: `mcp__${'s'.repeat(20)}__${'t'.repeat(20)}`, input: {}, output: undefined }).label).toBe('generic');
});

test('strips a Codex shell wrapper only from the first-line headline', () => {
  const zsh = toolPresentation({ name: "/bin/zsh -lc 'bun test'", input: undefined, output: undefined });
  const bash = toolPresentation({ name: "/bin/bash -lc 'ls -la'", input: undefined, output: undefined });
  const multiline = toolPresentation({ name: '\nfor f in *.ts; do\n  echo "$f"\ndone', input: undefined, output: undefined });
  expect(zsh.headline).toBe('bun test');
  expect(bash.headline).toBe('ls -la');
  expect(multiline.headline).toBe('for f in *.ts; do…');
  expect(multiline.headline).not.toContain('\n');
});

test('does not truncate a code headline to the generic scalar limit', () => {
  const source = `const value = ${'x'.repeat(120)};`;
  const value = toolPresentation({ name: 'eval', input: { code: source, language: 'javascript' }, output: undefined });
  expect(value).toMatchObject({ family: 'code', headline: source, badges: ['javascript'] });
  expect(value.headline.length).toBeGreaterThan(80);
});
```

Add these exact `elideHeadline()` assertions.

```ts
expect(elideHeadline('packages/web/src/lib/tool-presentation.ts', 'path')).toEqual({
  kind: 'path',
  head: 'packages/web/src/lib/',
  tail: 'tool-presentation.ts',
});
expect(elideHeadline('README', 'path')).toEqual({ kind: 'path', head: '', tail: 'README' });
expect(elideHeadline('bun test', 'text')).toEqual({ kind: 'text', text: 'bun test' });
```

- [ ] **Step 2: Run the display-contract tests and verify RED**

Run: `bun test --cwd packages/web src/lib/tool-presentation.test.ts`

Expected: FAIL on chip fallback, MCP formatting, wrapper stripping, code display, or the missing elision exports.

- [ ] **Step 3: Implement the bounded display helpers**

Use these exact constants and mappings.

```ts
const MAX_LABEL_LENGTH = 24;

export const FAMILY_CHIP_TOKEN: Record<ToolFamily, string> = {
  shell: '--node-bash',
  code: '--node-bash',
  file: '--node-command',
  web: '--node-command',
  search: '--node-prompt',
  glob: '--node-prompt',
  todo: '--node-approval',
  task: '--node-approval',
  generic: '--text-secondary',
};
```

Implement the chip rule as `/^\S+$/` plus `name.length <= 24`; never truncate a chip.
Implement `chipAriaLabel` as `${label}, ${family} tool` when `label !== family`, otherwise `${family} tool`, so the family is available without chip colour and the same family word is not spoken twice.
Implement MCP parsing before normal resolution with `/^mcp__(.+?)__(.+)$/` and the settled long-label fallback.
Strip only a matching `/bin/zsh -lc '…'` or `/bin/bash -lc '…'` wrapper for headline selection.
Select the first non-empty line and add `…` only when another non-empty line follows.
Implement `elideHeadline()` as a last-slash split for paths and an unchanged text arm for other headlines.

- [ ] **Step 4: Run the resolver suite and verify GREEN**

Run: `bun test --cwd packages/web src/lib/tool-presentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Add a failing generic-headline test**

```ts
test('uses at most three scalar pairs for a generic collapsed headline', () => {
  const value = toolPresentation({
    name: 'mystery',
    input: { a: 1, nested: { x: 1 }, b: 'two', list: [1, 2], c: true, d: 'ignored' },
    output: undefined,
  });
  expect(value).toMatchObject({ family: 'generic', headline: 'a: 1 · b: two · c: true' });
  expect(value.headline).not.toMatch(/[{}[\]"]/);
});

test('bounds generic scalar display and terminates on a large source line', () => {
  const scalar = toolPresentation({ name: 'mystery', input: { value: 'z'.repeat(200) }, output: undefined });
  const source = 'a'.repeat(100_000);
  const code = toolPresentation({ name: 'eval', input: { code: source, language: 'txt' }, output: undefined });
  expect(scalar.headline).toBe(`value: ${'z'.repeat(80)}…`);
  expect(code.headline).toBe(source);
});

test('does not traverse a hostile __proto__ value', () => {
  const hostile: unknown = JSON.parse('{"__proto__":{"polluted":true},"safe":"ok"}');
  const value = toolPresentation({ name: 'mystery', input: hostile, output: undefined });
  expect(value.headline).toBe('safe: ok');
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

```

- [ ] **Step 6: Run the generic tests and verify RED**

Run: `bun test --cwd packages/web src/lib/tool-presentation.test.ts`

Expected: FAIL because generic scalar selection is not implemented.

- [ ] **Step 7: Implement bounded generic display**

Add `MAX_GENERIC_SCALARS = 3` and `MAX_GENERIC_VALUE_LENGTH = 80` only after the failing tests in Step 6 establish their behavior.
Treat only string, finite number, boolean, and null as generic scalar values.
Truncate a generic scalar's string form after 80 characters by keeping the first 80 characters and adding `…`.
Ignore arrays and objects when composing the generic collapsed headline.
Use the sent name when no scalar pair exists.
Do not enumerate nested values and do not call `JSON.stringify()`.

- [ ] **Step 8: Run the resolver suite and verify GREEN**

Run: `bun test --cwd packages/web src/lib/tool-presentation.test.ts`

Expected: PASS.

- [ ] **Step 9: Type-check and lint the resolver**

Run: `bun --filter @archon/web type-check`

Run: `bun x eslint packages/web/src/lib/tool-presentation.ts packages/web/src/lib/tool-presentation.test.ts`

Expected: both commands exit zero with no warnings.

- [ ] **Step 10: Commit the completed resolver**

```bash
git add packages/web/src/lib/tool-presentation.ts packages/web/src/lib/tool-presentation.test.ts
git commit -m "feat(web): complete readable tool row presentation"
```

---

## Task 3: Attach shared row data and fold interrupted lifecycle rows

**Files:**

- Modify: `packages/web/src/lib/agent-history.ts`
- Modify: `packages/web/src/lib/agent-history.test.ts`
- Modify: `packages/web/src/components/workflows/NodeRoom.test.tsx`

**Interfaces:**

- Consumes: `toolPresentation`, `ToolPresentation`, and `formatDurationMs`.
- Produces:

```ts
export type ToolOutcome = 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown';
export type BadgeTone = 'default' | 'error' | 'warning' | 'muted';
export interface ToolBadge {
  text: string;
  tone: BadgeTone;
  priority: 'sticky' | 'droppable';
}
export interface ToolRowView {
  glyph: string;
  outcomeLabel: string;
  badges: ToolBadge[];
}
export function initialToolExpanded(outcome: ToolOutcome): boolean;
export function toolRowView(
  item: Extract<AgentHistoryItem, { kind: 'tool' }>,
  outputState?: 'full' | 'truncated' | 'missing' | 'unknown'
): ToolRowView;
```

The tool arm of `AgentHistoryItem` gains `exitCode: number | null` and `presentation: ToolPresentation`.
Keep `context` until Task 6 so Tasks 4 and 5 can remove both renderer readers before the field disappears.

- [ ] **Step 1: Add a failing exit-code and presentation projection test**

Add a `Bash` call/result pair whose result metadata contains `exit_code: 1` and assert this exact projection.

```ts
expect(tool).toMatchObject({
  kind: 'tool',
  outcome: 'failed',
  exitCode: 1,
  presentation: {
    family: 'shell',
    label: 'Bash',
    headline: 'bun test',
    headlineKind: 'text',
  },
});
expect(toolRowView(tool).badges).toContainEqual({
  text: 'exit 1',
  tone: 'error',
  priority: 'sticky',
});
```

- [ ] **Step 2: Run the history test and verify RED**

Run: `bun test --cwd packages/web src/lib/agent-history.test.ts`

Expected: FAIL because the tool item lacks `exitCode` and `presentation`, and `toolRowView` is not exported.

- [ ] **Step 3: Carry the exit code and presentation through `toToolItem()`**

Add a private `resolveExitCode(card: ToolCard): number | null` next to `deriveOutcome()`.
Resolve result metadata before call metadata before `card.exitCode`.
Use the helper inside `deriveOutcome()` and `toToolItem()` so the failure decision and visible badge cannot disagree.
Attach `toolPresentation({ name: card.name, input: card.input, output: card.output })` in `toToolItem()`.
Add the smallest `toolRowView()` that emits the outcome glyph and label plus payload and non-zero-exit badges needed by the tracer test.

- [ ] **Step 4: Run the history test and verify GREEN for the tracer bullet**

Run: `bun test --cwd packages/web src/lib/agent-history.test.ts`

Expected: the new projection test passes, with any fixture type errors left for Step 8.

- [ ] **Step 5: Add failing expansion-table and complete-row-view tests**

Add one table-driven expansion test with these exact entries.

```ts
const EXPANSION_CASES: readonly [ToolOutcome, boolean][] = [
  ['succeeded', false],
  ['failed', true],
  ['running', false],
  ['interrupted', false],
  ['unknown', false],
];

test('initial expansion is table-driven for all five outcomes', () => {
  for (const [outcome, expanded] of EXPANSION_CASES) {
    expect(initialToolExpanded(outcome)).toBe(expanded);
  }
});
```

Add one badge-order test using a tool item with `presentation.badges: ['javascript']`, `exitCode: 1`, `outputState: 'truncated'`, and `durationMs: 1500`.
Assert the exact text order `['javascript', 'exit 1', 'truncated', '1.5s']` and assert that only the duration badge has `priority: 'droppable'`.
Add one glyph table assertion for `✓`, `✕`, `◐`, `⚠`, and `–` through `toolRowView()` rather than through renderer-owned maps.

- [ ] **Step 6: Run the history test and verify RED**

Run: `bun test --cwd packages/web src/lib/agent-history.test.ts`

Expected: FAIL because the expansion table and complete row view are not implemented.

- [ ] **Step 7: Complete the shared row view**

Use total records for glyphs, labels, and initial state.

```ts
const STATUS_GLYPH: Record<ToolOutcome, string> = {
  succeeded: '✓',
  failed: '✕',
  running: '◐',
  interrupted: '⚠',
  unknown: '–',
};

const OUTCOME_LABEL: Record<ToolOutcome, string> = {
  succeeded: 'succeeded',
  failed: 'failed',
  running: 'running',
  interrupted: 'interrupted',
  unknown: 'unknown outcome',
};

const INITIAL_EXPANDED: Record<ToolOutcome, boolean> = {
  succeeded: false,
  failed: true,
  running: false,
  interrupted: false,
  unknown: false,
};
```

`toolRowView()` must append payload badges first, a non-zero exit badge second, an output marker third, and duration last.
Use `warning` for `truncated`, `muted` for `output missing` and `output unknown`, and `default` for duration and payload facts.
Set only duration to `droppable`.

- [ ] **Step 8: Run the row-view tests and verify GREEN**

Run: `bun test --cwd packages/web src/lib/agent-history.test.ts`

Expected: PASS.

- [ ] **Step 9: Add failing interrupted-fold tests**

Add a call/result/`statusRow('interrupted')` fixture and assert the final item list contains one tool with `outcome: 'interrupted'` and no lifecycle item.
Add a non-interrupted lifecycle fixture and assert it remains present.
Add an orphan interrupted lifecycle fixture and assert it remains present because no tool immediately precedes it.

- [ ] **Step 10: Run the fold tests and verify RED**

Run: `bun test --cwd packages/web src/lib/agent-history.test.ts`

Expected: FAIL because the interrupted lifecycle item is still emitted.

- [ ] **Step 11: Implement the interrupted fold**

Implement the fold as a final pass over the projected `AgentHistoryItem[]`.
When the current item is a lifecycle item with `state === 'interrupted'` and the already-emitted previous item is a tool, replace that previous item with a copy whose outcome is `interrupted` and omit the lifecycle item.
Preserve every other lifecycle item.

- [ ] **Step 12: Run the fold tests and verify GREEN**

Run: `bun test --cwd packages/web src/lib/agent-history.test.ts`

Expected: PASS.

- [ ] **Step 13: Update typed tool fixtures**

Run: `bun --filter @archon/web type-check`.

Add `exitCode: null` and a structurally complete `presentation` to the `toolItem()` default in `packages/web/src/components/workflows/NodeRoom.test.tsx`.
Use `{ family: 'file', label: 'Read', chipAriaLabel: 'Read, file tool', headline: 'a.ts', headlineKind: 'path', badges: [] }`.
The current repository has no other hand-authored production or test tool item literal; treat any additional type-check failure as repository drift and update only the literal named by that diagnostic.

- [ ] **Step 14: Run the history suite and type-check**

Run: `bun test --cwd packages/web src/lib/agent-history.test.ts`

Run: `bun --filter @archon/web type-check`

Expected: both commands pass.

- [ ] **Step 15: Commit the shared projection**

```bash
git add packages/web/src/lib/agent-history.ts packages/web/src/lib/agent-history.test.ts packages/web/src/components/workflows/NodeRoom.test.tsx
git commit -m "feat(web): project readable tool row status and badges"
```

---

## Task 4: Render the native disclosure row on Legacy

**Files:**

- Modify: `packages/web/src/components/workflows/NodeRoom.tsx`
- Modify: `packages/web/src/components/workflows/NodeRoom.test.tsx`

**Interfaces:**

- Consumes: `initialToolExpanded`, `toolRowView`, `ToolOutcome`, `BadgeTone`, `FAMILY_CHIP_TOKEN`, and `elideHeadline`.
- Produces: no new module export.

- [ ] **Step 1: Add failing Legacy summary tests**

Add a helper that extracts only the first `<summary data-testid="tool-summary">…</summary>` fragment before applying `visibleText()`.
Do not use the whole static markup to decide whether a closed native disclosure is visually collapsed.

Cover these exact observations:

- A succeeded item renders `<details>` without `open=""`.
- A failed item renders `<details open="">`.
- The summary contains the correct glyph, chip label, full filename tail, and non-zero exit badge.
- The summary has no `{`, `[`, or `"` from the raw Input/Output payload.
- The glyph has an accessible outcome label.
- The chip has the resolver-provided family-aware accessible label and `title="file"` for a file fixture.

Use the happy-dom pattern already present in `packages/web/src/components/workflows/NodeRoomHeader.test.tsx` for two live-transition tests.
Render a running tool item through `createRoot()`, re-render the same item id as failed, and assert the untouched `<details>` opens.
Render a second running item, click its summary twice so the reader opens and closes it, re-render it as failed, and assert it stays closed.

- [ ] **Step 2: Run the Legacy test and verify RED**

Run: `NODE_ENV=development bun test --cwd packages/web src/components/workflows/NodeRoom.test.tsx`

Expected: FAIL because the current renderer has no native tool disclosure summary, glyph, family chip, exit badge, or untouched-row transition.

- [ ] **Step 3: Add the Legacy disclosure-state helper**

Add this renderer-local hook above `ToolHistory()`.
The stable initial ref prevents polling from reasserting the initial `open` value, and the click marker lets manual reader choice outrank later failure transitions.

```ts
function useToolDisclosure(outcome: ToolOutcome): {
  detailsRef: React.RefObject<HTMLDetailsElement | null>;
  initialOpen: boolean;
  markTouched: () => void;
} {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const touchedRef = useRef(false);
  const initialOpenRef = useRef(initialToolExpanded(outcome));

  useEffect(() => {
    if (!touchedRef.current && outcome === 'failed' && detailsRef.current !== null) {
      detailsRef.current.open = true;
    }
  }, [outcome]);

  return {
    detailsRef,
    initialOpen: initialOpenRef.current,
    markTouched: (): void => {
      touchedRef.current = true;
    },
  };
}
```

Merge `useEffect` and `useRef` into the existing React import.
Do not use controlled React state for `open`.

- [ ] **Step 4: Replace the Legacy tool header with `<details>/<summary>`**

Keep the existing full-output loading state and `loadFull()` function.
Compute `const row = toolRowView(item, displayedOutputState)`.
Use `open={disclosure.initialOpen || undefined}` only as the stable initial attribute.
Set `data-tool-id={item.toolUseId}` on `<details>` and `data-testid="tool-summary"` on `<summary>`.
Put `onClick={disclosure.markTouched}` on `<summary>` so mouse and keyboard activation mark the row as reader-controlled.
Use a `group` class on `<details>` and two `aria-hidden` chevron spans so CSS switches `▸` and `▾` from native open state.
Hide the browser's default marker with `list-none` and `[&::-webkit-details-marker]:hidden`.
Give the summary `min-h-6`, one flex line, `min-w-0`, and no wrapping.
Render the glyph with `role="img"`, `aria-label={row.outcomeLabel}`, and the Legacy token returned by this exhaustive helper.

```ts
function glyphColor(outcome: ToolOutcome): string {
  switch (outcome) {
    case 'succeeded': return 'var(--success)';
    case 'failed': return 'var(--error)';
    case 'running': return 'var(--accent-bright)';
    case 'interrupted': return 'var(--warning)';
    case 'unknown': return 'var(--text-secondary)';
  }
}
```

Render the chip text exactly as `item.presentation.label`.
Set the chip `aria-label` to `item.presentation.chipAriaLabel`, `title` to `item.presentation.family`, and its foreground and border from `FAMILY_CHIP_TOKEN`.
Use this exact chip style.

```ts
const chipToken = FAMILY_CHIP_TOKEN[item.presentation.family];
const chipStyle: React.CSSProperties = {
  color: `var(${chipToken})`,
  borderColor: `color-mix(in oklch, var(${chipToken}) 40%, transparent)`,
  backgroundColor: 'var(--surface-elevated)',
};
```
Render a path headline as a shrinkable head span plus a fixed tail span from `elideHeadline()`.
Render a text headline as one `truncate` span.
Keep the full strings as span text; do not slice them in JSX.
Render `row.badges` in array order.
Push the badge group to the right with `margin-left: auto` and keep it on one line.
Map `default` and `muted` to `--text-secondary`, `error` to `--error`, and `warning` to `--warning`.
Give sticky badges `shrink-0` and droppable duration `min-w-0 shrink overflow-hidden` so semantic badges remain while duration can disappear under pressure.

Inside the disclosure body, keep only the current Input block, Output block, `View full output` control, and retry error treatment.
Convert the two nested always-open `<details>` blocks to non-interactive labelled `<div>` sections because a tool card now has one disclosure owner.
Do not render `item.presentation.body`; Story 1.1 defines no such field.

- [ ] **Step 5: Run all Legacy row tests and verify GREEN**

Run: `NODE_ENV=development bun test --cwd packages/web src/components/workflows/NodeRoom.test.tsx`

Expected: PASS for the initial summary contract and both live-transition cases.

- [ ] **Step 6: Type-check and lint Legacy**

Run: `bun --filter @archon/web type-check`

Run: `bun x eslint packages/web/src/components/workflows/NodeRoom.tsx packages/web/src/components/workflows/NodeRoom.test.tsx`

Expected: both commands exit zero with no warnings.

- [ ] **Step 7: Commit Legacy**

```bash
git add packages/web/src/components/workflows/NodeRoom.tsx packages/web/src/components/workflows/NodeRoom.test.tsx
git commit -m "feat(web): render Legacy tool calls as readable rows"
```

---

## Task 5: Render the same native disclosure row on Console

**Files:**

- Modify: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`

**Interfaces:**

- Consumes: `initialToolExpanded`, `toolRowView`, `ToolOutcome`, `BadgeTone`, `FAMILY_CHIP_TOKEN`, and `elideHeadline`.
- Produces: no new module export.

- [ ] **Step 1: Add failing Console row tests through wire fixtures**

Add a succeeded `Read` call/result pair with `tool_phase: 'call'` and `tool_phase: 'result'` in top-level metadata.
After rendering, query `details[data-tool-id="read-1"]` and its summary.
Assert `details.open === false`, the summary includes `✓`, `Read`, and `a.ts`, and the summary excludes the raw output string and JSON punctuation.

Add a failed `Bash` call/result pair whose call metadata contains `tool_phase: 'call'` and whose result metadata contains `tool_phase: 'result'` plus `exit_code: 1`.
Assert `details.open === true`, the summary includes `✕`, `Bash`, `bun test`, and `exit 1`, and the body still contains the output string.

Update the existing test at `ConsoleNodeRoom.test.tsx:1002` so it asserts the tool disclosure and summary contract instead of asserting that a successful or unknown card has an open nested details block.

Import `ConsoleAgentHistoryList` in the existing dynamic-import setup and render it directly for two live-transition tests.
Build the running and failed `AgentHistoryItem[]` inputs with `buildAgentHistory()` so the test does not hand-author the shared item shape.
First render a running call without a result, re-render the same tool id with a result carrying `outcome: 'error'`, and assert the untouched details opens.
Repeat with a summary that is manually opened and closed before the failed item is rendered, and assert it remains closed.

- [ ] **Step 2: Run the Console test and verify RED**

Run: `NODE_ENV=development bun test --cwd packages/web src/experiments/console/components/ConsoleNodeRoom.test.tsx`

Expected: FAIL because Console still renders the old open JSON card and has no untouched-row transition.

- [ ] **Step 3: Mirror the Legacy markup with Console's running token**

Merge `useEffect` and `useRef` into the React import.
Add this complete renderer-local helper; the deliberate two-shell duplication is required by architecture AD-12.

```ts
function useToolDisclosure(outcome: ToolOutcome): {
  detailsRef: React.RefObject<HTMLDetailsElement | null>;
  initialOpen: boolean;
  markTouched: () => void;
} {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const touchedRef = useRef(false);
  const initialOpenRef = useRef(initialToolExpanded(outcome));

  useEffect(() => {
    if (!touchedRef.current && outcome === 'failed' && detailsRef.current !== null) {
      detailsRef.current.open = true;
    }
  }, [outcome]);

  return {
    detailsRef,
    initialOpen: initialOpenRef.current,
    markTouched: (): void => {
      touchedRef.current = true;
    },
  };
}
```

Render `<details data-tool-id={item.toolUseId}>` with the stable initial `open` attribute and a `<summary data-testid="tool-summary">` carrying `onClick={disclosure.markTouched}`.
Render the two CSS-switched chevrons, the status glyph with `role="img"` and its shared outcome label, the family-labelled chip, the split path or truncated text headline, and the shared ordered badges.
Keep sticky badges fixed and give only droppable duration `min-w-0 shrink overflow-hidden`.
Replace the nested Input and Output disclosures with labelled body sections under the one tool disclosure.
Keep `View full output`, loading, error, and retry behavior unchanged.
Use this exhaustive Console colour helper.

```ts
function glyphColor(outcome: ToolOutcome): string {
  switch (outcome) {
    case 'succeeded': return 'var(--success)';
    case 'failed': return 'var(--error)';
    case 'running': return 'var(--running)';
    case 'interrupted': return 'var(--warning)';
    case 'unknown': return 'var(--text-secondary)';
  }
}
```

Keep the existing `var(--rv-tool-card-border, 1px solid var(--border))` fallback.
Import shared code only from `@/lib/agent-history` and `@/lib/tool-presentation`; do not import Legacy JSX.

- [ ] **Step 4: Run all Console row tests and verify GREEN**

Run: `NODE_ENV=development bun test --cwd packages/web src/experiments/console/components/ConsoleNodeRoom.test.tsx`

Expected: PASS for the initial row contract and both live-transition cases.

- [ ] **Step 5: Run the Console boundary and static checks**

Run: `bun test --cwd packages/web src/experiments/console/console-isolation.test.ts`

Run: `bun --filter @archon/web type-check`

Run: `bun x eslint packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`

Expected: every command passes with no warnings.

- [ ] **Step 6: Commit Console**

```bash
git add packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx
git commit -m "feat(web): render Console tool calls as readable rows"
```

---

## Task 6: Remove superseded context, record evidence, and close Story 1.1

**Files:**

- Modify: `packages/web/src/lib/agent-history.ts`
- Modify: `packages/web/src/lib/agent-history.test.ts`
- Modify: `packages/web/src/components/workflows/NodeRoom.test.tsx`
- Modify: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
- Create: `_bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md`

**Interfaces:**

- Removes: tool-item `context`, `TOOL_CONTEXT_KEYS`, and `toolContext()`.
- Keeps: `input`, `output`, and current full-output loading for Stories 1.2 and 1.3.

- [ ] **Step 1: Prove the old context path has no production reader**

Run: `rg -n "\.context\b|toolContext|TOOL_CONTEXT_KEYS" packages/web/src -g '!*.test.*'`

Expected before cleanup: matches only inside `packages/web/src/lib/agent-history.ts`.

- [ ] **Step 2: Remove the old context path and its characterization tests**

Delete the `context` field from the tool arm, the constant, the function, and the `toToolItem()` assignment.
Delete the `toolContext` import and describe block from `agent-history.test.ts`.
Delete `context` from the Legacy `toolItem()` fixture.

- [ ] **Step 3: Verify no context reference remains**

Run: `rg -n "\.context\b|toolContext|TOOL_CONTEXT_KEYS" packages/web/src`

Expected: no matches.

- [ ] **Step 4: Run every focused Story 1.1 test**

Run: `bun test --cwd packages/web src/lib/tool-presentation.test.ts`

Run: `bun test --cwd packages/web src/lib/agent-history.test.ts`

Run: `NODE_ENV=development bun test --cwd packages/web src/components/workflows/NodeRoom.test.tsx`

Run: `NODE_ENV=development bun test --cwd packages/web src/experiments/console/components/ConsoleNodeRoom.test.tsx`

Run: `bun test --cwd packages/web src/experiments/console/console-isolation.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Run the complete web package test script**

Run: `bun --filter @archon/web test`

Expected: all `src/lib`, `src/stores`, `src/hooks`, `src/components`, component-integration, and Console legs pass.

- [ ] **Step 6: Mark the sprint item done**

Change only this line in `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`.

```yaml
  1-1-scan-a-tool-call-as-one-readable-row: done
```

- [ ] **Step 7: Create durable characterization evidence**

Create `_bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md` after the focused and package tests pass.
Record the fixed date `2026-09-16`.
Copy the exact commit hash and subject lines returned by `git log --reverse --format='%H %s' --grep='readable rows' --grep='readable tool row'` into the evidence file.
Copy the exact pass counts printed by the four focused test files and the Console isolation test into the evidence file.
Map the acceptance criteria to these exact test groups:

- One-line anatomy and initial disclosure state map to `NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx` readable-row tests.
- The five-outcome table maps to `agent-history.test.ts` `initial expansion is table-driven for all five outcomes`.
- Glyphs and chip rules map to the `toolRowView` glyph table and `tool-presentation.test.ts` display-contract tests.
- Safe degradation and bounded scalar formatting map to `tool-presentation.test.ts` malformed and generic headline tests.
- Exit-code visibility maps to the shared badge-order test and both renderer tests.
- Interrupted folding maps to `agent-history.test.ts` interrupted lifecycle fold tests.
- Console isolation maps to `console-isolation.test.ts`.

Do not claim a command passed unless its output in this run shows zero failures.

- [ ] **Step 8: Run the required repository gate**

Run: `bun run validate`

Expected: type-check, lint with zero warnings, format check, generated-file checks, and the isolated package test legs all pass.

- [ ] **Step 9: Check the final diff and commit**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors and only the files listed by this plan are changed.

```bash
git add packages/web/src/lib/agent-history.ts packages/web/src/lib/agent-history.test.ts packages/web/src/components/workflows/NodeRoom.test.tsx _bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml _bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md
git commit -m "refactor(web): remove superseded tool context and close ANR 1.1"
```

---

## Acceptance Criteria and Verification Map

- Each Legacy and Console tool call has one native summary row containing chevron, glyph, family chip, headline, and right-aligned badges.
- Succeeded, failed, running, interrupted, and unknown initial states are covered by one shared table with values `false`, `true`, `false`, `false`, and `false`.
- An untouched running row opens when it becomes failed, while a reader-opened or reader-closed row keeps the reader's choice.
- The exact glyphs are visible characters and carry accessible outcome names.
- The family chip uses the sent short token or family fallback and exposes the resolved family without relying on colour.
- The summary never contains raw serialized input or output.
- Unknown structured input uses at most three scalar pairs, while malformed input resolves to a safe generic row without throwing.
- The non-zero exit code, output-state marker, payload facts, and duration are composed once in shared code and rendered in the same order on both shells.
- An immediately following `interrupted` lifecycle row disappears into the preceding tool outcome; other lifecycle rows remain.
- Existing full-output loading remains reachable after opening the tool disclosure.
- `sprint-status.yaml` is committed as `done` only after focused tests, package tests, and `bun run validate` pass.

## Open Questions

None.

## Implementation Order

1. Build and commit exact family classification.
2. Add and commit the chip, headline, safe-degradation, and elision behavior.
3. Attach the presentation and shared row view, then fold interrupted lifecycle rows.
4. Implement and verify Legacy native disclosure behavior.
5. Implement and verify the matching Console behavior and isolation boundary.
6. Remove the obsolete context path, record evidence, run the full gate, mark the story done, and commit the closeout.

Do not reorder the shell tasks ahead of the shared projection because both renderers depend on the new typed fields.
Do not mark the sprint item done or write passing evidence before the corresponding commands actually pass.
