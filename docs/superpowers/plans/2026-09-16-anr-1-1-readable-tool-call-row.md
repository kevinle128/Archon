# ANR Story 1.1 — Scan a Tool Call as One Readable Row — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-open Input/Output JSON block for each agent tool call with one scannable collapsed row — chevron, colour-independent status glyph, family chip, elided headline, and right-aligned badges — on both the Legacy and Console node rooms, driven by a shared pure resolver.

**Architecture:** A new React-free module `packages/web/src/lib/tool-presentation.ts` turns a call's `{name, input, output}` into a `ToolPresentation` (family, chip label, headline, badges, and a `terminal`/`generic` body arm). The shared projector `packages/web/src/lib/agent-history.ts` attaches that presentation plus the carried-through `exitCode` to every tool item, folds a following `interrupted` status row into the preceding call, and exposes render-neutral helpers (`STATUS_GLYPH`, `initialToolExpanded`, `toolBadges`). Each surface's renderer (`NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`) consumes that data and adds only markup, so the two shells stay independent while sharing all logic.

**Tech Stack:** TypeScript (strict), React 19, Tailwind v4 with the existing `--node-*` / status CSS tokens, Bun test (`renderToStaticMarkup` on Legacy, happy-dom + `createRoot` on Console).

## Global Constraints

- Strict TypeScript, complete type annotations, no unjustified `any`, zero ESLint warnings (`--max-warnings 0`); the change must pass `bun run validate`. (NFR7)
- `@archon/web` must never import from `@archon/workflows`; wire types come from `api.generated.d.ts` via `@/lib/api`. (Additional Requirements)
- Console (`packages/web/src/experiments/console/`) must not import from `@/components/`, `@/stores`, `@/contexts`, `@/routes`, `@/hooks`, or `@tanstack/react-query` (enforced by `console-isolation.test.ts`).
- Status meaning must be decodable without colour: the glyph carries the meaning and colour is applied in addition, never instead. (NFR2)
- Raw `JSON.stringify` output must never be the default transcript presentation; the collapsed row must contain no serialized-data punctuation. (NFR3)
- Epic 1 has no schema, migration, or backend change; this is pure presentation of already-stored data and improves historical runs immediately. (NFR1)
- Use only existing design tokens — never hard-code hex values. Family chip hues are `--node-bash` / `--node-command` / `--node-prompt` / `--node-approval`; status colours are `--success` / `--error` / `--warning` / `--text-secondary`, with the running glyph using `--accent-bright` on Legacy and `--running` on Console. (DESIGN.md, brand rule)
- Do not run bare `bun test` from the repo root; run path-scoped test files during TDD and `bun run validate` as the pre-PR gate. (AGENTS.md, test-plan.md)
- Spec authorities, in precedence order when a mockup conflicts: `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`, `_bmad-output/specs/spec-agent-node-room/test-plan.md`, then `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/{DESIGN,EXPERIENCE}.md`.

---

## Scope and Non-Goals

This plan implements **only** Story 1.1 (CAP-1): the collapsed one-row rendering, the resolver's classification of every family, the colour-independent glyph, the chip rule, safe degradation of adversarial payloads, and the read-half interrupted fold.

**In scope (Story 1.1):**

- The pure resolver producing collapsed-row fields for all four tiers: `family`, `label`, `headline`, `headlineKind`, `badges`, and the `terminal` / `generic` body arms.
- Both renderers rewritten to the collapsed row with initial expansion table-driven by outcome.
- `agent-history.ts` carrying `exitCode` and the attached `presentation` onto each tool item, plus the interrupted-status fold.

**Deferred to later stories — do not build here:**

- Story 1.2 (CAP-7): the per-card **Raw toggle**. Story 1.1 keeps the existing Input/Output `<pre>` blocks inside the expanded region so operators retain full payload access until the Raw toggle lands.
- Story 1.3 (CAP-2): the family-shaped expanded bodies (`matches` / `paths` / `code` / rich `file` view) and the `output_mode`-driven arm selection. Story 1.1's `body` union is only `terminal | generic`; Stories 1.3/1.4/1.6 widen it.
- Story 1.4 (CAP-5): inline diffs, `diff-hunks.ts`, and the `git-hunk-adapter.ts` move.
- Story 1.5 (CAP-3): the pinned todo strip and `TodoPhase[]` fold. `buildAgentHistory` keeps its `AgentHistoryItem[]` return type; its three call sites (`ConsoleNodeRoom.tsx:607`, `NodeTranscriptPane.tsx:236`, `ConsoleExecutionHistory.tsx:204`) need **no** edit.
- Story 1.6 (CAP-4): the `task` → `TaskSubtask[]` normalizer and subtask cards. Do **not** export `TaskSubtask` yet.
- Story 1.7 (CAP-6): occurrence grouping and the loop-iteration selector.

---

## File Structure

- **Create** `packages/web/src/lib/tool-presentation.ts` — the pure, React-free resolver. One responsibility: `{name, input, output}` → `ToolPresentation`. Also exports `FAMILY_CHIP_TOKEN` and `elideHeadline`.
- **Create** `packages/web/src/lib/tool-presentation.test.ts` — table-driven resolver tests (CAP-1 slice).
- **Modify** `packages/web/src/lib/agent-history.ts` — add `presentation` + `exitCode` to the tool item; add `resolveExitCode`, `STATUS_GLYPH`, `OUTCOME_ARIA`, `initialToolExpanded`, `toolBadges`, `foldInterruptedStatus`, and the exported `ToolOutcome` type; remove `context` / `toolContext` / `TOOL_CONTEXT_KEYS` (in the final task, once no renderer reads them).
- **Modify** `packages/web/src/lib/agent-history.test.ts` — assert the new fields and helpers; add the interrupted-fold test; drop the `toolContext` describe block in the final task.
- **Modify** `packages/web/src/components/workflows/NodeRoom.tsx` — rewrite `ToolHistory` to the collapsed row (Legacy tokens).
- **Modify** `packages/web/src/components/workflows/NodeRoom.test.tsx` — update the `toolItem` fixture and add collapsed-row / glyph / exit-badge / headline-elision assertions.
- **Modify** `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` — rewrite `ToolHistory` to the collapsed row (Console tokens).
- **Modify** `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` — add the same collapsed-row assertions on the Console surface (its fixtures feed rows, not item literals).
- **Modify** `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` — flip `1-1-scan-a-tool-call-as-one-readable-row` to `done` (final task).

---

## Open Questions

Each has a chosen provisional default so the plan is executable without blocking.

1. **Interrupted status-row state string.** Story 1.1's read-half fold must recognise a `status` row emitted by Epic 2's write half. The write half does not exist yet, and no current status state is literally `interrupted` (verified against `packages/workflows/src` and `packages/core/src`). **Provisional default:** fold when the lifecycle item's `state === 'interrupted'`. Epic 2 (Story 2.3) must emit exactly that state; leave a code comment saying so.
2. **Long MCP labels vs the `label.length <= 24` invariant.** The contract maps `mcp__server__tool` → label `server · tool`, but a long server/tool pair would exceed 24. **Provisional default:** build `server · tool`, and if it exceeds 24 characters fall back to the family name `generic`.
3. **Generic body "no JSON dump" test wording.** `tool-presentation-contract.md` mandates the `{…}` / `[n]` placeholders for nested objects/arrays, while `test-plan.md` says assert the generic output contains "no `{`". A literal `{…}` contains `{`, so the two conflict. **Provisional default:** keep the contract's `{…}` / `[n]` placeholders (behavioural authority, FR2) and assert the no-dump *intent* — the output contains no JSON-object signature (`/\{\s*"/` and no `\n  "` indented quoted key). One-line change to `…` if a reviewer insists on the literal.
4. **`body` arms in this story.** Story 1.1 produces only `terminal` and `generic`. **Provisional default:** declare `body` as `{kind:'terminal'} | {kind:'generic'}` now; Stories 1.3/1.4/1.6 widen the union — do not add unused arms here (YAGNI).

### Decisions (settled, not open)

- **Exit-code badge policy.** Render `exit N` only when `exitCode !== null && exitCode !== 0`, coloured with `--error`. This matches the contract's examples (the `[read]` success row carries no exit badge; the failed `[bash]` row shows `exit 1`) and the test-plan's single assertion. A successful call's `✓` glyph already signals success.

---

## Reference — the current tool item and renderers

`AgentHistoryItem` (tool arm) today (`agent-history.ts:26-41`) carries `outcome: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown'`, `context`, `input`, `output`, `durationMs`, `canLoadFullOutput`, `outputState`, `messageId`, and `toolUseId`.
`deriveOutcome` (`:120`) already parses the exit code but discards it after deciding `failed`; `resolveExitCode` will surface it.
`buildAgentHistory` (`:207`) projects rows into items and returns `AgentHistoryItem[]`.
The two renderers' `ToolHistory` components (`NodeRoom.tsx:192-291`, `ConsoleAgentHistoryList.tsx:126-223`) are near-identical: a header line (`item.name`, an outcome word, output-state markers, duration), then `item.context.map(...)`, then two `<details open>` Input/Output panes, then the `canLoadFullOutput` "View full output" button.
Only two production sites read `item.context`: `NodeRoom.tsx:246` and `ConsoleAgentHistoryList.tsx:178`.
Console renderer tests feed **rows** through `buildAgentHistory` (via `loadMessages`), so they are unaffected by the item-shape change; only the Legacy `toolItem` fixture (`NodeRoom.test.tsx:82-101`) constructs a full `AgentHistoryItem` literal.

---

## Task 1: Pure resolver `tool-presentation.ts`

**Files:**
- Create: `packages/web/src/lib/tool-presentation.ts`
- Test: `packages/web/src/lib/tool-presentation.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; no `@archon/*` or React imports).
- Produces:
  ```ts
  export interface ToolPresentationInput { name: string; input: unknown; output: unknown; }
  export type ToolFamily =
    | 'shell' | 'file' | 'search' | 'glob' | 'code' | 'todo' | 'task' | 'web' | 'generic';
  export interface ToolPresentation {
    family: ToolFamily;
    label: string;
    headline: string;
    headlineKind: 'path' | 'text';
    badges: string[];
    body:
      | { kind: 'terminal'; command: string }
      | { kind: 'generic'; fields: { key: string; value: string }[] };
  }
  export function toolPresentation(input: ToolPresentationInput): ToolPresentation;
  export const FAMILY_CHIP_TOKEN: Record<ToolFamily, string>;
  export type ElidedHeadline = { kind: 'path'; head: string; tail: string } | { kind: 'text'; text: string };
  export function elideHeadline(headline: string, headlineKind: 'path' | 'text'): ElidedHeadline;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/tool-presentation.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { elideHeadline, toolPresentation, type ToolFamily } from './tool-presentation';

interface Case {
  title: string;
  name: string;
  input: unknown;
  family: ToolFamily;
  label: string;
  headline?: string;
  headlineKind?: 'path' | 'text';
  badges?: string[];
}

const CASES: Case[] = [
  // Tier 1 — measured aliases resolve to the right family.
  { title: 'read_file → file', name: 'read_file', input: { path: 'a.ts' }, family: 'file', label: 'read_file' },
  { title: 'run_terminal_command → shell', name: 'run_terminal_command', input: { command: 'ls' }, family: 'shell', label: 'run_terminal_command' },
  { title: 'search_tool → search', name: 'search_tool', input: { pattern: 'x' }, family: 'search', label: 'search_tool' },
  { title: 'list_dir → glob', name: 'list_dir', input: { path: 'src' }, family: 'glob', label: 'list_dir' },
  // search_replace contains "search" but is an EDIT tool — substring-matching regression guard.
  { title: 'search_replace → file (not search)', name: 'search_replace', input: { old_string: 'a', new_string: 'b' }, family: 'file', label: 'search_replace' },
  { title: 'Edit → file, chip as sent', name: 'Edit', input: { file_path: 'a.ts' }, family: 'file', label: 'Edit' },
  // Tier 2 — duck-type key alternates resolve.
  { title: 'target_file resolves as path', name: 'mystery', input: { target_file: 'x.ts' }, family: 'file', label: 'file', headline: 'x.ts', headlineKind: 'path' },
  { title: 'old_str/new_str resolves as edit', name: 'mystery', input: { old_str: 'a', new_str: 'b', file_path: 'z.ts' }, family: 'file', label: 'file' },
];

describe('toolPresentation resolver tiers', () => {
  for (const c of CASES) {
    test(c.title, () => {
      const p = toolPresentation({ name: c.name, input: c.input, output: undefined });
      expect(p.family).toBe(c.family);
      expect(p.label).toBe(c.label);
      if (c.headline !== undefined) expect(p.headline).toBe(c.headline);
      if (c.headlineKind !== undefined) expect(p.headlineKind).toBe(c.headlineKind);
      if (c.badges !== undefined) expect(p.badges).toEqual(c.badges);
    });
  }

  test('every row keeps label.length <= 24', () => {
    for (const c of CASES) {
      const p = toolPresentation({ name: c.name, input: c.input, output: undefined });
      expect(p.label.length).toBeLessThanOrEqual(24);
    }
  });
});

describe('glob key trap', () => {
  test('Claude glob headlines the pattern, not the search directory', () => {
    const p = toolPresentation({ name: 'Glob', input: { pattern: '**/*.tsx', path: 'packages/web' }, output: undefined });
    expect(p.family).toBe('glob');
    expect(p.headline).toBe('**/*.tsx');
    expect(p.headline).not.toBe('packages/web');
    expect(p.headlineKind).toBe('path');
  });

  test('OMP glob headlines the path when there is no pattern', () => {
    const p = toolPresentation({ name: 'glob', input: { path: 'packages/web/src' }, output: undefined });
    expect(p.family).toBe('glob');
    expect(p.headline).toBe('packages/web/src');
  });
});

describe('shell name handling', () => {
  test('Codex shape with no input resolves to shell with the name as headline', () => {
    const p = toolPresentation({ name: 'npm test', input: undefined, output: undefined });
    expect(p.family).toBe('shell');
    expect(p.headline).toBe('npm test');
    expect(p.label).toBe('shell'); // multi-token name falls back to the family
  });

  test('a multi-line Codex name headlines only its first non-empty line', () => {
    const p = toolPresentation({ name: '\nfor f in *.ts; do\n  echo "$f"\ndone', input: undefined, output: undefined });
    expect(p.headline).not.toContain('\n');
    expect(p.headline).toBe('for f in *.ts; do…');
  });

  test('a /bin/zsh -lc wrapper is stripped from the headline but kept for the body', () => {
    const p = toolPresentation({ name: "/bin/zsh -lc 'bun test node-room'", input: undefined, output: undefined });
    expect(p.headline.startsWith('/bin/')).toBe(false);
    expect(p.headline).toBe('bun test node-room');
    // the untouched name is preserved for the terminal body
    expect(p.body).toEqual({ kind: 'terminal', command: "/bin/zsh -lc 'bun test node-room'" });
  });

  test('a /bin/bash -lc wrapper is stripped too', () => {
    const p = toolPresentation({ name: "/bin/bash -lc 'ls -la'", input: undefined, output: undefined });
    expect(p.headline).toBe('ls -la');
  });
});

describe('code family', () => {
  test('eval with {code, language} → family code, first-line headline, language badge, untruncated source', () => {
    const longFirstLine = `const x = ${'y'.repeat(120)};`;
    const p = toolPresentation({ name: 'eval', input: { code: `${longFirstLine}\nconsole.log(x)`, language: 'javascript' }, output: undefined });
    expect(p.family).toBe('code');
    expect(p.headline.startsWith('const x =')).toBe(true);
    expect(p.badges).toEqual(['javascript']);
    expect(p.headline.length).toBeGreaterThan(80); // NOT truncated to the generic 80-char cut
  });
});

describe('chip rule', () => {
  test('a short single-token name is kept verbatim; a long one falls back to the family', () => {
    expect(toolPresentation({ name: 'Grep', input: { pattern: 'x' }, output: undefined }).label).toBe('Grep');
    const longName = 'x'.repeat(40);
    expect(toolPresentation({ name: longName, input: {}, output: undefined }).label.length).toBeLessThanOrEqual(24);
  });

  test('the chip is never the case-folded separator-stripped form', () => {
    expect(toolPresentation({ name: 'read_file', input: { path: 'a.ts' }, output: undefined }).label).toBe('read_file');
    expect(toolPresentation({ name: 'read_file', input: { path: 'a.ts' }, output: undefined }).label).not.toBe('readfile');
  });

  test('an emoji-bearing name passes through unchanged when it is a single short token', () => {
    expect(toolPresentation({ name: '🚀run', input: {}, output: undefined }).label).toBe('🚀run');
  });
});

describe('mcp names', () => {
  test('mcp__server__tool → generic with label "server · tool"', () => {
    const p = toolPresentation({ name: 'mcp__server__tool', input: {}, output: undefined });
    expect(p.family).toBe('generic');
    expect(p.label).toBe('server · tool');
  });

  test('a long mcp label falls back to the family name', () => {
    const p = toolPresentation({ name: `mcp__${'s'.repeat(20)}__${'t'.repeat(20)}`, input: {}, output: undefined });
    expect(p.label).toBe('generic');
    expect(p.label.length).toBeLessThanOrEqual(24);
  });
});

describe('generic fallback and safe degradation', () => {
  test('an unknown tool with object input renders at most three key: value pairs and no JSON dump', () => {
    const p = toolPresentation({
      name: 'mystery',
      input: { a: 1, b: 'two', c: true, d: 'four', nested: { deep: 1 }, list: [1, 2, 3] },
      output: undefined,
    });
    expect(p.family).toBe('generic');
    if (p.body.kind !== 'generic') throw new Error('expected generic body');
    expect(p.body.fields.length).toBeLessThanOrEqual(3);
    const dump = p.body.fields.map(f => `${f.key}: ${f.value}`).join('\n');
    expect(dump).not.toMatch(/\{\s*"/); // no JSON-object signature (see Open Question 3)
    expect(dump).not.toContain('\n  "');
  });

  test('long scalar values are cut to 80 characters', () => {
    const p = toolPresentation({ name: 'mystery', input: { big: 'z'.repeat(200) }, output: undefined });
    if (p.body.kind !== 'generic') throw new Error('expected generic body');
    expect(p.body.fields[0]?.value).toBe(`${'z'.repeat(80)}…`);
  });

  test('nested objects and arrays collapse to placeholders', () => {
    const p = toolPresentation({ name: 'mystery', input: { obj: { x: 1 }, arr: [1, 2] }, output: undefined });
    if (p.body.kind !== 'generic') throw new Error('expected generic body');
    expect(p.body.fields).toEqual([{ key: 'obj', value: '{…}' }, { key: 'arr', value: '[2]' }]);
  });

  test('empty, null, array, and non-string names never throw', () => {
    expect(() => toolPresentation({ name: '', input: null, output: null })).not.toThrow();
    expect(() => toolPresentation({ name: 'x', input: [], output: undefined })).not.toThrow();
    expect(() => toolPresentation({ name: 'x', input: '', output: undefined })).not.toThrow();
    // a hostile key must not poison the object walk
    expect(() => toolPresentation({ name: 'x', input: { ['__proto__']: 1, a: 2 }, output: undefined })).not.toThrow();
    // a non-string name (guarded) degrades to generic
    expect(() => toolPresentation({ name: 123 as unknown as string, input: {}, output: undefined })).not.toThrow();
  });

  test('a 100k-character source line stays bounded and returns quickly', () => {
    const p = toolPresentation({ name: 'eval', input: { code: 'a'.repeat(100_000), language: 'txt' }, output: undefined });
    expect(p.family).toBe('code');
    expect(typeof p.headline).toBe('string');
  });
});

describe('elideHeadline', () => {
  test('a path splits at the last slash so the filename tail survives', () => {
    expect(elideHeadline('packages/web/src/lib/tool-presentation.ts', 'path')).toEqual({
      kind: 'path',
      head: 'packages/web/src/lib/',
      tail: 'tool-presentation.ts',
    });
  });

  test('a slashless path yields an empty head', () => {
    expect(elideHeadline('README', 'path')).toEqual({ kind: 'path', head: '', tail: 'README' });
  });

  test('text elision returns a single span', () => {
    expect(elideHeadline('bun test', 'text')).toEqual({ kind: 'text', text: 'bun test' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/web/src/lib/tool-presentation.test.ts`
Expected: FAIL with a module-resolution error (`Cannot find module './tool-presentation'`).

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/lib/tool-presentation.ts`:

```ts
/**
 * Pure, React-free, provider-agnostic resolver that turns a tool call's
 * {name, input, output} into a scannable ToolPresentation. Both node-room
 * renderers consume it and add only markup. See
 * _bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md.
 *
 * Story 1.1 (CAP-1) produces the collapsed-row fields plus the `terminal` and
 * `generic` body arms. Stories 1.3/1.4/1.6 widen `body` with the family-shaped
 * arms (matches/paths/code/diff/task) and add their rendering.
 */

export interface ToolPresentationInput {
  name: string;
  input: unknown;
  output: unknown;
}

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

export interface ToolPresentation {
  family: ToolFamily;
  /** Chip text: the tool name AS SENT when it is one token of <=24 chars, else the family name. */
  label: string;
  /** The single salient argument — command, path, pattern. Never JSON. */
  headline: string;
  /** 'path' elides in the MIDDLE so the filename survives; 'text' elides at the end. */
  headlineKind: 'path' | 'text';
  /** Collapsed-row semantic facts derived from the payload (e.g. code language). */
  badges: string[];
  body:
    | { kind: 'terminal'; command: string }
    | { kind: 'generic'; fields: { key: string; value: string }[] };
}

/** family → CSS custom property carrying its chip hue (declared in index.css / theme.css). */
export const FAMILY_CHIP_TOKEN: Record<ToolFamily, string> = {
  shell: '--node-bash',
  file: '--node-command',
  web: '--node-command',
  search: '--node-prompt',
  glob: '--node-prompt',
  code: '--node-bash',
  todo: '--node-approval',
  task: '--node-approval',
  generic: '--text-secondary',
};

export type ElidedHeadline =
  | { kind: 'path'; head: string; tail: string }
  | { kind: 'text'; text: string };

export function elideHeadline(headline: string, headlineKind: 'path' | 'text'): ElidedHeadline {
  if (headlineKind === 'path') {
    const idx = headline.lastIndexOf('/');
    if (idx >= 0) {
      return { kind: 'path', head: headline.slice(0, idx + 1), tail: headline.slice(idx + 1) };
    }
    return { kind: 'path', head: '', tail: headline };
  }
  return { kind: 'text', text: headline };
}

const MAX_LABEL = 24;
const MAX_VALUE = 80;
const MAX_GENERIC_FIELDS = 3;

// Tier 1 alias sets, keyed on the NORMALIZED name (lower-cased, `_`/`-` stripped).
// Bolded aliases in the contract were measured against the real corpus, not guessed.
const FAMILY_ALIASES: { family: ToolFamily; aliases: string[] }[] = [
  { family: 'shell', aliases: ['bash', 'shell', 'run', 'command', 'execute', 'runterminalcommand'] },
  {
    family: 'file',
    aliases: [
      'edit', 'write', 'create', 'strreplace', 'applypatch', 'notebookedit', 'searchreplace',
      'delete', 'read', 'view', 'cat', 'open', 'readfile',
    ],
  },
  { family: 'search', aliases: ['grep', 'search', 'rg', 'searchtool'] },
  { family: 'glob', aliases: ['glob', 'find', 'ls', 'list', 'listdir'] },
  { family: 'code', aliases: ['eval', 'runcode', 'executecode'] },
  { family: 'todo', aliases: ['todo', 'todowrite', 'plan'] },
  { family: 'task', aliases: ['task', 'agent', 'subagent', 'dispatch'] },
  { family: 'web', aliases: ['webfetch', 'websearch', 'fetch', 'browse'] },
];

const NORMALIZED_ALIAS: Map<string, ToolFamily> = (() => {
  const map = new Map<string, ToolFamily>();
  for (const { family, aliases } of FAMILY_ALIASES) {
    for (const alias of aliases) {
      if (!map.has(alias)) map.set(alias, family);
    }
  }
  return map;
})();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, '');
}

function hasKey(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some(key => record[key] !== undefined);
}

function firstString(record: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (record === null) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function stripShellWrapper(source: string): string {
  const match = /^\/bin\/(?:ba|z)sh -lc '([\s\S]*)'$/.exec(source);
  return match ? (match[1] ?? source) : source;
}

function firstNonEmptyLine(source: string): string {
  const lines = source.split('\n');
  let idx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim().length > 0) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return '';
  const head = (lines[idx] ?? '').trim();
  const more = lines.slice(idx + 1).some(line => line.trim().length > 0);
  return more ? `${head}…` : head;
}

function scalarText(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') return '{…}';
  const text = typeof value === 'string' ? value : String(value);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

function genericFields(record: Record<string, unknown> | null): { key: string; value: string }[] {
  if (record === null) return [];
  const fields: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (fields.length >= MAX_GENERIC_FIELDS) break;
    fields.push({ key, value: scalarText(value) });
  }
  return fields;
}

const COMMAND_KEYS = ['command', 'cmd', 'script'] as const;
const PATH_KEYS = ['file_path', 'path', 'target_file', 'file', 'filename', 'notebook_path'] as const;
const PATTERN_KEYS = ['pattern', 'query', 'regex', 'search'] as const;
const URL_KEYS = ['url', 'uri'] as const;

function resolveFamily(
  tier1: ToolFamily | null,
  record: Record<string, unknown> | null,
  name: string
): ToolFamily {
  if (tier1 !== null) return tier1;
  // Tier 2 — duck-type on input keys; first hit wins.
  if (record !== null) {
    if (hasKey(record, ['code']) && hasKey(record, ['language'])) return 'code';
    if (hasKey(record, COMMAND_KEYS)) return 'shell';
    if (hasKey(record, PATH_KEYS)) return 'file';
    if (hasKey(record, PATTERN_KEYS)) return 'search';
    if (hasKey(record, URL_KEYS)) return 'web';
  }
  // Tier 3 — name-only (empty input): every Codex call.
  if ((record === null || Object.keys(record).length === 0) && name.length > 0) return 'shell';
  // Tier 4 — generic.
  return 'generic';
}

function chipLabel(name: string, family: ToolFamily): string {
  if (/^\S+$/.test(name) && name.length <= MAX_LABEL) return name;
  return family;
}

function headlineFor(
  family: ToolFamily,
  record: Record<string, unknown> | null,
  name: string
): string {
  switch (family) {
    case 'shell':
      return firstNonEmptyLine(stripShellWrapper(firstString(record, COMMAND_KEYS) ?? name));
    case 'file':
      return firstString(record, PATH_KEYS) ?? name;
    case 'glob':
      // `path` means opposite things in the two glob tools: headline the pattern when present,
      // otherwise the path (OMP's `path` IS the pattern; Claude's `path` is the search directory).
      return firstString(record, ['pattern']) ?? firstString(record, ['path']) ?? name;
    case 'search':
      return firstString(record, PATTERN_KEYS) ?? name;
    case 'code':
      return firstNonEmptyLine(firstString(record, ['code']) ?? name);
    case 'web':
      return firstString(record, URL_KEYS) ?? name;
    case 'todo':
    case 'task':
    case 'generic':
    default:
      return name;
  }
}

function headlineKindFor(family: ToolFamily): 'path' | 'text' {
  return family === 'file' || family === 'glob' ? 'path' : 'text';
}

function badgesFor(family: ToolFamily, record: Record<string, unknown> | null): string[] {
  if (family === 'code') {
    const language = firstString(record, ['language']);
    if (language !== null) return [language];
  }
  return [];
}

function bodyFor(
  family: ToolFamily,
  record: Record<string, unknown> | null,
  name: string
): ToolPresentation['body'] {
  if (family === 'shell') {
    return { kind: 'terminal', command: firstString(record, COMMAND_KEYS) ?? name };
  }
  return { kind: 'generic', fields: genericFields(record) };
}

export function toolPresentation(input: ToolPresentationInput): ToolPresentation {
  const name = typeof input.name === 'string' ? input.name : '';
  const record = asRecord(input.input);

  // MCP names bypass family resolution (matches the backend formatter convention).
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) {
    const combined = `${mcp[1]} · ${mcp[2]}`;
    return {
      family: 'generic',
      label: combined.length <= MAX_LABEL ? combined : 'generic',
      headline: combined,
      headlineKind: 'text',
      badges: [],
      body: { kind: 'generic', fields: genericFields(record) },
    };
  }

  const family = resolveFamily(NORMALIZED_ALIAS.get(normalizeName(name)) ?? null, record, name);
  return {
    family,
    label: chipLabel(name, family),
    headline: headlineFor(family, record, name),
    headlineKind: headlineKindFor(family),
    badges: badgesFor(family, record),
    body: bodyFor(family, record, name),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/web/src/lib/tool-presentation.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Type-check and lint the new module**

Run: `bun --filter @archon/web type-check`
Expected: no errors.
Run: `bun x eslint packages/web/src/lib/tool-presentation.ts packages/web/src/lib/tool-presentation.test.ts`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/tool-presentation.ts packages/web/src/lib/tool-presentation.test.ts
git commit -m "feat(web): add pure tool-presentation resolver for readable transcript rows"
```

---

## Task 2: Attach presentation, carry exitCode, fold interrupted status in `agent-history.ts`

**Files:**
- Modify: `packages/web/src/lib/agent-history.ts`
- Test: `packages/web/src/lib/agent-history.test.ts`
- Test fixtures that construct tool `AgentHistoryItem` literals: `packages/web/src/components/workflows/NodeRoom.test.tsx` (the `toolItem` helper). Use `bun --filter @archon/web type-check` after the type change to enumerate any others.

**Interfaces:**
- Consumes: `toolPresentation`, `ToolPresentation` from `./tool-presentation` (Task 1); `formatDurationMs(ms: number): string` from `./format`.
- Produces (added to the tool arm of `AgentHistoryItem` and as module exports):
  ```ts
  export type ToolOutcome = 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown';
  // tool AgentHistoryItem gains:  presentation: ToolPresentation;  exitCode: number | null;
  export function resolveExitCode(card: ToolCard): number | null;
  export const STATUS_GLYPH: Record<ToolOutcome, string>;         // ✓ ✕ ◐ ⚠ –
  export const OUTCOME_ARIA: Record<ToolOutcome, string>;         // accessible names
  export function initialToolExpanded(outcome: ToolOutcome): boolean;
  export type BadgeTone = 'default' | 'error' | 'warning' | 'muted';
  export interface ToolBadge { text: string; tone: BadgeTone; }
  export function toolBadges(
    item: Extract<AgentHistoryItem, { kind: 'tool' }>,
    outputState?: 'full' | 'truncated' | 'missing' | 'unknown'
  ): ToolBadge[];
  ```
  `context` / `toolContext` / `TOOL_CONTEXT_KEYS` remain until Task 5.

- [ ] **Step 1: Write the failing tests**

Add to `packages/web/src/lib/agent-history.test.ts` (import the new exports at the top):

```ts
import {
  buildAgentHistory,
  initialToolExpanded,
  STATUS_GLYPH,
  toolBadges,
  toolContext,
  toolRuntime,
  type AgentHistoryItem,
} from './agent-history';
```

`resolveExitCode` stays an internal/exported helper of `agent-history.ts` (used by `deriveOutcome` and `toToolItem`); it is exercised through `buildAgentHistory` above rather than imported directly.

```ts
describe('initialToolExpanded', () => {
  test('is table-driven: only failed calls start expanded', () => {
    expect(initialToolExpanded('succeeded')).toBe(false);
    expect(initialToolExpanded('failed')).toBe(true);
    expect(initialToolExpanded('running')).toBe(false);
    expect(initialToolExpanded('interrupted')).toBe(false);
    expect(initialToolExpanded('unknown')).toBe(false);
  });
});

describe('STATUS_GLYPH', () => {
  test('maps the five outcomes to distinct colour-independent glyphs', () => {
    expect(STATUS_GLYPH).toEqual({
      succeeded: '✓',
      failed: '✕',
      running: '◐',
      interrupted: '⚠',
      unknown: '–',
    });
  });
});

describe('tool item presentation and exit code', () => {
  test('a bash call carries a resolver presentation and its non-zero exit code', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({ id: 'c', seq: 1, name: 'Bash', toolUseId: 'b', input: { command: 'bun test' }, metadata: { tool_phase: 'call' } }),
        toolRow({ id: 'r', seq: 2, name: 'Bash', toolUseId: 'b', output: 'boom', metadata: { tool_phase: 'result', exit_code: 1 } }),
      ],
    });
    const tool = items[0];
    if (tool?.kind !== 'tool') throw new Error('expected tool item');
    expect(tool.outcome).toBe('failed');
    expect(tool.exitCode).toBe(1);
    expect(tool.presentation.family).toBe('shell');
    expect(tool.presentation.label).toBe('Bash');
    expect(tool.presentation.headline).toBe('bun test');
    const badges = toolBadges(tool);
    expect(badges).toContainEqual({ text: 'exit 1', tone: 'error' });
  });

  test('a successful read carries a null exit code and no exit badge', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({ id: 'c', seq: 1, name: 'Read', toolUseId: 'r', input: { path: 'a.ts' }, metadata: { tool_phase: 'call' } }),
        toolRow({ id: 'r', seq: 2, name: 'Read', toolUseId: 'r', output: 'body', metadata: { tool_phase: 'result' } }),
      ],
    });
    const tool = items[0];
    if (tool?.kind !== 'tool') throw new Error('expected tool item');
    expect(tool.exitCode).toBeNull();
    expect(toolBadges(tool).some(b => b.text.startsWith('exit'))).toBe(false);
  });
});

describe('exit code call-side fallback', () => {
  test('an exit code recorded on the call row (no result yet) still reaches the item', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({ id: 'c', seq: 1, name: 'Bash', toolUseId: 'b', input: { command: 'x' }, metadata: { tool_phase: 'call', exit_code: 2 } }),
      ],
    });
    const tool = items[0];
    if (tool?.kind !== 'tool') throw new Error('expected tool item');
    expect(tool.exitCode).toBe(2);
  });
});

describe('interrupted status fold', () => {
  test('folds a following interrupted status row into the preceding tool call (non-Claude)', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({ id: 'c', seq: 1, name: 'grep', toolUseId: 'g', input: { pattern: 'x' }, metadata: { tool_phase: 'call' } }),
        toolRow({ id: 'r', seq: 2, name: 'grep', toolUseId: 'g', output: 'partial', metadata: { tool_phase: 'result' } }),
        statusRow('s', 3, 'interrupted'),
      ],
    });
    expect(items).toHaveLength(1);
    const tool = items[0];
    if (tool?.kind !== 'tool') throw new Error('expected tool item');
    expect(tool.outcome).toBe('interrupted');
    expect(STATUS_GLYPH[tool.outcome]).toBe('⚠');
  });

  test('folds interrupted over a would-be failed outcome even with a result between call and status', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({ id: 'c', seq: 1, name: 'Bash', toolUseId: 'b', input: { command: 'sleep 99' }, metadata: { tool_phase: 'call' } }),
        toolRow({ id: 'r', seq: 2, name: 'Bash', toolUseId: 'b', output: 'x', metadata: { tool_phase: 'result', exit_code: 130 } }),
        statusRow('s', 3, 'interrupted'),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'tool', outcome: 'interrupted' });
  });

  test('a non-interrupted status row is preserved as a lifecycle item', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({ id: 'c', seq: 1, name: 'Read', toolUseId: 'r', input: { path: 'a.ts' }, metadata: { tool_phase: 'call' } }),
        toolRow({ id: 'r', seq: 2, name: 'Read', toolUseId: 'r', output: 'b', metadata: { tool_phase: 'result' } }),
        statusRow('s', 3, 'iteration_completed', '1'),
      ],
    });
    expect(items.map(i => i.kind)).toEqual(['tool', 'lifecycle']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/web/src/lib/agent-history.test.ts`
Expected: FAIL — `initialToolExpanded`, `STATUS_GLYPH`, `resolveExitCode`, `toolBadges` are not exported, and the fold tests see a lifecycle item where they expect a folded tool.

- [ ] **Step 3: Write the implementation**

In `packages/web/src/lib/agent-history.ts`:

Add imports at the top:

```ts
import { formatDurationMs } from './format';
import { toolPresentation, type ToolPresentation } from './tool-presentation';
```

Export the outcome type (replace the local alias at `:52`):

```ts
export type ToolOutcome = 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown';
```

Add `presentation` and `exitCode` to the tool arm of `AgentHistoryItem` (after `outputState` / `messageId`):

```ts
      messageId: string;
      exitCode: number | null;
      presentation: ToolPresentation;
    };
```

Add `resolveExitCode` next to `deriveOutcome`, and use it inside `deriveOutcome`:

```ts
export function resolveExitCode(card: ToolCard): number | null {
  const resultFields = extraToolFields(card.result);
  const callFields = extraToolFields(card.call);
  return resultFields.exitCode ?? callFields.exitCode ?? card.exitCode ?? null;
}
```

Inside `deriveOutcome`, replace the local `const exitCode = resultFields.exitCode ?? callFields.exitCode ?? card.exitCode ?? null;` with `const exitCode = resolveExitCode(card);` (keep the rest of `deriveOutcome` unchanged).

Populate the two new fields in `toToolItem` (keep the existing `context: toolContext(card.input)` line for now):

```ts
    messageId: card.result?.id ?? card.call?.id ?? card.id,
    exitCode: resolveExitCode(card),
    presentation: toolPresentation({ name: card.name, input: card.input, output: card.output }),
  };
```

Add the render-neutral helpers (place them after `toolRuntime`):

```ts
export const STATUS_GLYPH: Record<ToolOutcome, string> = {
  succeeded: '✓',
  failed: '✕',
  running: '◐',
  interrupted: '⚠',
  unknown: '–',
};

export const OUTCOME_ARIA: Record<ToolOutcome, string> = {
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

export function initialToolExpanded(outcome: ToolOutcome): boolean {
  return INITIAL_EXPANDED[outcome];
}

export type BadgeTone = 'default' | 'error' | 'warning' | 'muted';

export interface ToolBadge {
  text: string;
  tone: BadgeTone;
}

export function toolBadges(
  item: Extract<AgentHistoryItem, { kind: 'tool' }>,
  outputState: 'full' | 'truncated' | 'missing' | 'unknown' = item.outputState
): ToolBadge[] {
  const badges: ToolBadge[] = [];
  for (const text of item.presentation.badges) badges.push({ text, tone: 'default' });
  if (item.exitCode !== null && item.exitCode !== 0) {
    badges.push({ text: `exit ${item.exitCode}`, tone: 'error' });
  }
  if (item.durationMs !== null) {
    badges.push({ text: formatDurationMs(item.durationMs), tone: 'default' });
  }
  if (outputState === 'truncated') badges.push({ text: 'truncated', tone: 'warning' });
  else if (outputState === 'missing') badges.push({ text: 'output missing', tone: 'muted' });
  else if (outputState === 'unknown') badges.push({ text: 'output unknown', tone: 'muted' });
  return badges;
}
```

Add the fold and apply it in `buildAgentHistory`:

```ts
// A following `interrupted` status row belongs to the tool call it stopped, not the timeline.
// Fold it into the preceding tool item and drop the row so the reader sees `⚠ interrupted`.
// Epic 2 (Story 2.3) writes that status row with `state === 'interrupted'` (see Open Question 1).
function foldInterruptedStatus(items: AgentHistoryItem[]): AgentHistoryItem[] {
  const result: AgentHistoryItem[] = [];
  for (const item of items) {
    if (item.kind === 'lifecycle' && item.state === 'interrupted') {
      const prev = result[result.length - 1];
      if (prev !== undefined && prev.kind === 'tool') {
        result[result.length - 1] = { ...prev, outcome: 'interrupted' };
        continue;
      }
    }
    result.push(item);
  }
  return result;
}
```

Change the final line of `buildAgentHistory` from `return items;` to:

```ts
  return foldInterruptedStatus(items);
```

- [ ] **Step 4: Fix broken tool-item fixtures surfaced by the type-checker**

Run: `bun --filter @archon/web type-check`
Expected initially: errors on every `AgentHistoryItem` tool literal missing `presentation` / `exitCode` (known: the `toolItem` helper in `NodeRoom.test.tsx:82-101`).

For `NodeRoom.test.tsx`, add the two fields to the `toolItem` helper defaults (keep `context` for now):

```ts
    outputState: 'truncated',
    messageId: 'msg-tool-1',
    exitCode: null,
    presentation: {
      family: 'file',
      label: 'Read',
      headline: 'a.ts',
      headlineKind: 'path',
      badges: [],
      body: { kind: 'generic', fields: [{ key: 'path', value: 'a.ts' }] },
    },
    ...overrides,
```

Import `ToolPresentation` if the literal needs a cast; the object above is structurally complete, so no cast is required.
For any other file the type-checker flags, add `exitCode: null` and a matching minimal `presentation` object the same way.
Re-run `bun --filter @archon/web type-check` until clean.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test packages/web/src/lib/agent-history.test.ts`
Expected: PASS, including the existing `distinguishes retrievable response truncation and preserves interrupted outcomes` test (unchanged — the metadata-outcome path still works) and the new fold tests.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/agent-history.ts packages/web/src/lib/agent-history.test.ts packages/web/src/components/workflows/NodeRoom.test.tsx
git commit -m "feat(web): carry exitCode + tool presentation and fold interrupted status rows"
```

---

## Task 3: Collapsed tool row on the Legacy surface (`NodeRoom.tsx`)

**Files:**
- Modify: `packages/web/src/components/workflows/NodeRoom.tsx`
- Test: `packages/web/src/components/workflows/NodeRoom.test.tsx`

**Interfaces:**
- Consumes: `initialToolExpanded`, `STATUS_GLYPH`, `OUTCOME_ARIA`, `toolBadges`, `type ToolOutcome`, `type BadgeTone` from `@/lib/agent-history`; `FAMILY_CHIP_TOKEN`, `elideHeadline` from `@/lib/tool-presentation`.
- Produces: no new module exports; the tool row now renders a collapse toggle, glyph, chip, elided headline, and badge strip.

- [ ] **Step 1: Write the failing tests**

The Legacy test harness renders to a static string with `renderToStaticMarkup` and strips tags via `visibleText`.
Add to `packages/web/src/components/workflows/NodeRoom.test.tsx` (using the existing `renderRoom` / `visibleText` helpers; construct items with the `toolItem` helper):

```ts
describe('collapsed tool row', () => {
  test('a successful call is collapsed: its Input/Output body is not in the initial markup', () => {
    const markup = renderRoom({
      items: [toolItem({ outcome: 'succeeded', input: { path: 'a.ts' }, output: 'file body here', outputState: 'full', canLoadFullOutput: false })],
    });
    expect(visibleText(markup)).not.toContain('file body here');
  });

  test('a failed call is expanded: its body is in the initial markup', () => {
    const markup = renderRoom({
      items: [toolItem({ outcome: 'failed', name: 'Bash', input: { command: 'bun test' }, output: 'stack trace here', outputState: 'full', canLoadFullOutput: false, exitCode: 1,
        presentation: { family: 'shell', label: 'Bash', headline: 'bun test', headlineKind: 'text', badges: [], body: { kind: 'terminal', command: 'bun test' } } })],
    });
    expect(visibleText(markup)).toContain('stack trace here');
  });

  test('status is a glyph character, not colour alone', () => {
    const markup = renderRoom({ items: [toolItem({ outcome: 'succeeded' })] });
    expect(markup).toContain('✓');
  });

  test('a non-zero exit code shows an exit badge on the collapsed row', () => {
    const markup = renderRoom({
      items: [toolItem({ outcome: 'failed', name: 'Bash', exitCode: 1,
        presentation: { family: 'shell', label: 'Bash', headline: 'bun test', headlineKind: 'text', badges: [], body: { kind: 'terminal', command: 'bun test' } } })],
    });
    expect(visibleText(markup)).toContain('exit 1');
  });

  test('a long path headline elides in the middle and keeps the filename tail', () => {
    const markup = renderRoom({
      items: [toolItem({ outcome: 'succeeded',
        presentation: { family: 'file', label: 'Read', headline: 'packages/web/src/lib/tool-presentation.ts', headlineKind: 'path', badges: [], body: { kind: 'generic', fields: [] } } })],
    });
    expect(visibleText(markup)).toContain('tool-presentation.ts');
  });

  test('the chip renders the resolver label', () => {
    const markup = renderRoom({
      items: [toolItem({ presentation: { family: 'file', label: 'read_file', headline: 'a.ts', headlineKind: 'path', badges: [], body: { kind: 'generic', fields: [] } } })],
    });
    expect(visibleText(markup)).toContain('read_file');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NODE_ENV=development bun test packages/web/src/components/workflows/NodeRoom.test.tsx`
Expected: FAIL — the successful call's body is still in the markup (rows render fully today) and no `✓` / `exit 1` appears.

- [ ] **Step 3: Write the implementation**

In `packages/web/src/components/workflows/NodeRoom.tsx`, merge these names into the existing `@/lib/agent-history` import (the file already imports `buildAgentHistory` and `AgentHistoryItem` — add the new names, do not add a second import statement) and add a new `@/lib/tool-presentation` import:

```ts
import {
  buildAgentHistory,
  initialToolExpanded,
  OUTCOME_ARIA,
  STATUS_GLYPH,
  toolBadges,
  type AgentHistoryItem,
  type BadgeTone,
  type ToolOutcome,
} from '@/lib/agent-history';
import { elideHeadline, FAMILY_CHIP_TOKEN } from '@/lib/tool-presentation';
```

Add Legacy colour helpers above `ToolHistory` (replace the `toolOutcomeLabel` helper at `:186`):

```ts
function glyphColor(outcome: ToolOutcome): string {
  switch (outcome) {
    case 'succeeded':
      return 'var(--success)';
    case 'failed':
      return 'var(--error)';
    case 'running':
      return 'var(--accent-bright)'; // Legacy declares no --running
    case 'interrupted':
      return 'var(--warning)';
    case 'unknown':
    default:
      return 'var(--text-secondary)';
  }
}

function badgeClass(tone: BadgeTone): string {
  switch (tone) {
    case 'error':
      return 'text-error';
    case 'warning':
      return 'text-status-warning';
    case 'muted':
      return 'text-text-muted';
    case 'default':
    default:
      return 'text-text-secondary';
  }
}

function Headline({ headline, headlineKind }: { headline: string; headlineKind: 'path' | 'text' }): React.ReactElement {
  const elided = elideHeadline(headline, headlineKind);
  if (elided.kind === 'path') {
    return (
      <span className="flex min-w-0 flex-1 items-baseline text-[12px]">
        <span className="min-w-0 shrink truncate text-text-secondary">{elided.head}</span>
        <span className="shrink-0 text-text-primary">{elided.tail}</span>
      </span>
    );
  }
  return <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">{elided.text}</span>;
}
```

Replace the `ToolHistory` component body (`:192-291`) with:

```ts
function ToolHistory({
  item,
  runId,
  nodeId,
  loadMessage,
}: {
  item: Extract<AgentHistoryItem, { kind: 'tool' }>;
  runId: string;
  nodeId: string;
  loadMessage: typeof getWorkflowNodeMessage;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(initialToolExpanded(item.outcome));
  const [fullOutput, setFullOutput] = useState<unknown>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const displayedOutput = fullOutput === undefined ? item.output : fullOutput;
  const displayedOutputState = fullOutput === undefined ? item.outputState : 'full';
  const badges = toolBadges(item, displayedOutputState);

  const loadFull = (): void => {
    setLoading(true);
    setLoadError(null);
    void loadMessage(runId, nodeId, item.messageId)
      .then((message): void => {
        setFullOutput(message.kind === 'tool' ? message.payload.output : undefined);
        setLoading(false);
      })
      .catch((error: unknown): void => {
        setLoadError(error instanceof Error ? error.message : 'Failed to load full output');
        setLoading(false);
      });
  };

  return (
    <div
      data-tool-id={item.toolUseId}
      className="ptool rounded-[var(--radius)] bg-surface-inset px-2.5 py-2"
      style={{ border: 'var(--rv-tool-card-border)', overflowWrap: 'anywhere' }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(): void => setExpanded(value => !value)}
        className="flex w-full items-baseline gap-2 text-left font-mono"
      >
        <span aria-hidden="true" className="w-[9px] shrink-0 text-text-tertiary">
          {expanded ? '▾' : '▸'}
        </span>
        <span
          role="img"
          aria-label={OUTCOME_ARIA[item.outcome]}
          className="shrink-0 font-bold"
          style={{ color: glyphColor(item.outcome) }}
        >
          {STATUS_GLYPH[item.outcome]}
        </span>
        <span
          className="shrink-0 truncate rounded-[4px] border px-[7px] py-px text-[11px]"
          style={{
            maxWidth: '24ch',
            color: `var(${FAMILY_CHIP_TOKEN[item.presentation.family]})`,
            borderColor: `color-mix(in oklch, var(${FAMILY_CHIP_TOKEN[item.presentation.family]}) 40%, transparent)`,
            backgroundColor: 'var(--surface-elevated)',
          }}
        >
          {item.presentation.label}
        </span>
        <Headline headline={item.presentation.headline} headlineKind={item.presentation.headlineKind} />
        {badges.length > 0 ? (
          <span className="ml-auto flex shrink-0 items-baseline gap-2 whitespace-nowrap text-[11px]">
            {badges.map((badge, index) => (
              <span key={`${badge.text}-${index}`} className={badgeClass(badge.tone)}>
                {badge.text}
              </span>
            ))}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="mt-1.5 ml-[29px]">
          {item.presentation.body.kind === 'terminal' ? (
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
              {`$ ${item.presentation.body.command}`}
            </pre>
          ) : item.presentation.body.fields.length > 0 ? (
            <div className="text-[11px] text-text-secondary">
              {item.presentation.body.fields.map(field => (
                <div key={field.key}>
                  {field.key}: {field.value}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-1.5">
            <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">Input</div>
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
              {formatToolIo(item.input)}
            </pre>
          </div>
          <div className="mt-1.5">
            <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">Output</div>
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
              {formatToolIo(displayedOutput)}
            </pre>
          </div>
          {item.canLoadFullOutput ? (
            <button
              type="button"
              className="mt-1.5 text-xs text-primary hover:text-accent-bright"
              disabled={loading}
              onClick={loadFull}
            >
              View full output
            </button>
          ) : null}
          {loadError !== null ? (
            <div className="mt-1.5 text-[11px] text-error">
              <span>{loadError}</span>
              <button type="button" className="ml-2 text-xs text-primary hover:text-accent-bright" onClick={loadFull}>
                Retry
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

Delete the now-unused `toolOutcomeLabel` function and the `item.context.map(...)` block (it no longer exists in this component).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_ENV=development bun test packages/web/src/components/workflows/NodeRoom.test.tsx`
Expected: PASS. If a pre-existing test asserted the old always-open Input/Output layout, update its expectation to the collapsed/expanded behavior (a `succeeded` fixture is now collapsed).

- [ ] **Step 5: Type-check and lint**

Run: `bun --filter @archon/web type-check`
Expected: no errors.
Run: `bun x eslint packages/web/src/components/workflows/NodeRoom.tsx`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/workflows/NodeRoom.tsx packages/web/src/components/workflows/NodeRoom.test.tsx
git commit -m "feat(web): render Legacy tool calls as collapsed scannable rows"
```

---

## Task 4: Collapsed tool row on the Console surface (`ConsoleAgentHistoryList.tsx`)

**Files:**
- Modify: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`
- Test: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`

**Interfaces:**
- Consumes: the same `@/lib/agent-history` and `@/lib/tool-presentation` exports as Task 3. Import `formatDurationMs` stays via the existing `../../lib/format` path.
- Produces: no new module exports; identical anatomy to Legacy, Console tokens.

- [ ] **Step 1: Write the failing tests**

The Console harness uses happy-dom with `createRoot` and queries the live DOM (`host.textContent`, `host.querySelector`).
Add a describe block to `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` following the existing `renderRoom` + `flushUntil` pattern; feed rows through `loadMessages`:

```ts
describe('console collapsed tool row', () => {
  test('a successful tool call is collapsed and shows the family chip and glyph', async () => {
    const messages: WorkflowNodeMessage[] = [
      { id: 'c', seq: 1, kind: 'tool', payload: { name: 'Read', id: 't', input: { path: 'a.ts' } }, created_at: CREATED_AT },
      { id: 'r', seq: 2, kind: 'tool', payload: { name: 'Read', id: 't', output: 'secret-body-text' }, created_at: CREATED_AT },
    ];
    await act(async () => {
      renderRoom({ loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages }) });
    });
    await flushUntil('read row', () => (host.textContent ?? '').includes('Read'));
    expect(host.textContent ?? '').toContain('✓');
    expect(host.textContent ?? '').not.toContain('secret-body-text'); // collapsed
  });

  test('a failed bash call is expanded and shows an exit badge', async () => {
    const messages: WorkflowNodeMessage[] = [
      { id: 'c', seq: 1, kind: 'tool', payload: { name: 'Bash', id: 'b', input: { command: 'bun test' } }, created_at: CREATED_AT },
      { id: 'r', seq: 2, kind: 'tool', payload: { name: 'Bash', id: 'b', output: 'stack-trace-text' }, metadata: { exit_code: 1 }, created_at: CREATED_AT },
    ];
    await act(async () => {
      renderRoom({ loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({ messages }) });
    });
    await flushUntil('bash row', () => (host.textContent ?? '').includes('exit 1'));
    expect(host.textContent ?? '').toContain('✕');
    expect(host.textContent ?? '').toContain('stack-trace-text'); // failed → expanded
  });
});
```

Confirm the metadata shape for a Console row: check an existing fixture in this file that sets `metadata` on a `WorkflowNodeMessage`; if the type requires `metadata` under `payload` or a different key, mirror that shape exactly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NODE_ENV=development bun test packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`
Expected: FAIL — no `✓` glyph and the collapsed body text is still present.

- [ ] **Step 3: Write the implementation**

Apply the same rewrite as Task 3 to `ConsoleAgentHistoryList.tsx`, with Console token differences.
Add imports (merge into the existing `@/lib/agent-history` import; add the `@/lib/tool-presentation` import — it satisfies the Console isolation rule because `@/lib` is not on the forbidden list):

```ts
import {
  initialToolExpanded,
  OUTCOME_ARIA,
  STATUS_GLYPH,
  toolBadges,
  type AgentHistoryItem,
  type BadgeTone,
  type ToolOutcome,
} from '@/lib/agent-history';
import { elideHeadline, FAMILY_CHIP_TOKEN } from '@/lib/tool-presentation';
```

Add the Console `glyphColor`, `badgeClass`, and `Headline` helpers above `ToolHistory` (replace the Console `toolOutcomeLabel` at `:120`). `badgeClass` reuses the exact classes the current Console file already applies to the truncation markers (`text-status-warning`, `text-text-muted`), so the badges look identical to today:

```ts
function glyphColor(outcome: ToolOutcome): string {
  switch (outcome) {
    case 'succeeded':
      return 'var(--success)';
    case 'failed':
      return 'var(--error)';
    case 'running':
      return 'var(--running)'; // Console declares --running (Legacy uses --accent-bright)
    case 'interrupted':
      return 'var(--warning)';
    case 'unknown':
    default:
      return 'var(--text-secondary)';
  }
}

function badgeClass(tone: BadgeTone): string {
  switch (tone) {
    case 'error':
      return 'text-error';
    case 'warning':
      return 'text-status-warning';
    case 'muted':
      return 'text-text-muted';
    case 'default':
    default:
      return 'text-text-secondary';
  }
}

function Headline({ headline, headlineKind }: { headline: string; headlineKind: 'path' | 'text' }): ReactElement {
  const elided = elideHeadline(headline, headlineKind);
  if (elided.kind === 'path') {
    return (
      <span className="flex min-w-0 flex-1 items-baseline text-[12px]">
        <span className="min-w-0 shrink truncate text-text-secondary">{elided.head}</span>
        <span className="shrink-0 text-text-primary">{elided.tail}</span>
      </span>
    );
  }
  return <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">{elided.text}</span>;
}
```

Replace the Console `ToolHistory` (`:126-223`) in full with:

```ts
function ToolHistory({
  item,
  onLoadFullOutput,
}: {
  item: Extract<AgentHistoryItem, { kind: 'tool' }>;
  onLoadFullOutput: ConsoleAgentHistoryListProps['onLoadFullOutput'];
}): ReactElement {
  const [expanded, setExpanded] = useState(initialToolExpanded(item.outcome));
  const [fullOutput, setFullOutput] = useState<unknown>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const displayedOutput = fullOutput === undefined ? item.output : fullOutput;
  const displayedOutputState = fullOutput === undefined ? item.outputState : 'full';
  const badges = toolBadges(item, displayedOutputState);

  const loadFull = (): void => {
    setLoading(true);
    setLoadError(null);
    void onLoadFullOutput(item)
      .then((output): void => {
        setFullOutput(output);
        setLoading(false);
      })
      .catch((error: unknown): void => {
        setLoadError(error instanceof Error ? error.message : 'Failed to load full output');
        setLoading(false);
      });
  };

  return (
    <div
      data-tool-id={item.toolUseId}
      className="ptool rounded-[var(--radius)] bg-surface-inset px-2.5 py-2"
      style={{
        border: 'var(--rv-tool-card-border, 1px solid var(--border))',
        overflowWrap: 'anywhere',
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(): void => setExpanded(value => !value)}
        className="flex w-full items-baseline gap-2 text-left font-mono"
      >
        <span aria-hidden="true" className="w-[9px] shrink-0 text-text-tertiary">
          {expanded ? '▾' : '▸'}
        </span>
        <span
          role="img"
          aria-label={OUTCOME_ARIA[item.outcome]}
          className="shrink-0 font-bold"
          style={{ color: glyphColor(item.outcome) }}
        >
          {STATUS_GLYPH[item.outcome]}
        </span>
        <span
          className="shrink-0 truncate rounded-[4px] border px-[7px] py-px text-[11px]"
          style={{
            maxWidth: '24ch',
            color: `var(${FAMILY_CHIP_TOKEN[item.presentation.family]})`,
            borderColor: `color-mix(in oklch, var(${FAMILY_CHIP_TOKEN[item.presentation.family]}) 40%, transparent)`,
            backgroundColor: 'var(--surface-elevated)',
          }}
        >
          {item.presentation.label}
        </span>
        <Headline headline={item.presentation.headline} headlineKind={item.presentation.headlineKind} />
        {badges.length > 0 ? (
          <span className="ml-auto flex shrink-0 items-baseline gap-2 whitespace-nowrap text-[11px]">
            {badges.map((badge, index) => (
              <span key={`${badge.text}-${index}`} className={badgeClass(badge.tone)}>
                {badge.text}
              </span>
            ))}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="mt-1.5 ml-[29px]">
          {item.presentation.body.kind === 'terminal' ? (
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
              {`$ ${item.presentation.body.command}`}
            </pre>
          ) : item.presentation.body.fields.length > 0 ? (
            <div className="text-[11px] text-text-secondary">
              {item.presentation.body.fields.map(field => (
                <div key={field.key}>
                  {field.key}: {field.value}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-1.5">
            <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">Input</div>
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
              {formatToolIo(item.input)}
            </pre>
          </div>
          <div className="mt-1.5">
            <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">Output</div>
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
              {formatToolIo(displayedOutput)}
            </pre>
          </div>
          {item.canLoadFullOutput ? (
            <button
              type="button"
              className="mt-1.5 text-xs text-primary hover:text-accent-bright"
              disabled={loading}
              onClick={loadFull}
            >
              View full output
            </button>
          ) : null}
          {loadError !== null ? (
            <div className="mt-1.5 text-[11px] text-error">
              <span>{loadError}</span>
              <button type="button" className="ml-2 text-xs text-primary hover:text-accent-bright" onClick={loadFull}>
                Retry
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

Delete the Console `toolOutcomeLabel` function and the `item.context.map(...)` block (no longer present in this component).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_ENV=development bun test packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`
Expected: PASS. Update any pre-existing assertion that relied on the old always-open layout (e.g. a test asserting a successful call's output text is visible must now select or expand the row, since success is collapsed).

- [ ] **Step 5: Run the Console isolation and full web lib/component suites**

Run: `bun test packages/web/src/experiments/console/console-isolation.test.ts`
Expected: PASS (the new `@/lib/tool-presentation` import is allowed; nothing from `@/components/` was added).
Run: `bun --filter @archon/web type-check`
Expected: no errors.
Run: `bun x eslint packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx
git commit -m "feat(web): render Console tool calls as collapsed scannable rows"
```

---

## Task 5: Remove the superseded context path, validate, and close the story

**Files:**
- Modify: `packages/web/src/lib/agent-history.ts` (remove `context` field, `toolContext`, `TOOL_CONTEXT_KEYS`)
- Modify: `packages/web/src/lib/agent-history.test.ts` (remove the `toolContext` describe block and the `context:` assertion)
- Modify: `packages/web/src/components/workflows/NodeRoom.test.tsx` and any other test whose tool literal still sets `context`
- Modify: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`

- [ ] **Step 1: Confirm no production code still reads `context`**

Run: `rg -n "\.context\b|toolContext|TOOL_CONTEXT_KEYS" packages/web/src -g '!*.test.*'`
Expected: no matches (Tasks 3 and 4 removed both readers).

- [ ] **Step 2: Remove the dead code**

In `packages/web/src/lib/agent-history.ts`:
Remove the `context: { label: string; value: string }[];` field from the tool arm of `AgentHistoryItem`.
Remove the `TOOL_CONTEXT_KEYS` constant (`:50`) and the exported `toolContext` function (`:171-183`).
Remove the `context: toolContext(card.input),` line from `toToolItem`.

- [ ] **Step 3: Update the tests that reference `context`**

In `agent-history.test.ts`: remove the `toolContext` import, the entire `describe('toolContext', ...)` block, and the `context: [{ label: 'cmd', value: 'ls' }],` line inside the `buildAgentHistory` `toMatchObject` at `:286`.
In `NodeRoom.test.tsx` (and any file the type-checker flags): remove the `context: [...]` line from the tool fixture.

- [ ] **Step 4: Run the full web test suite and type-check**

Run: `bun --filter @archon/web type-check`
Expected: no errors.
Run: `bun --filter @archon/web test`
Expected: PASS across `src/lib`, `src/components`, and `src/experiments/console`.

- [ ] **Step 5: Flip the sprint status to done**

In `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`, change:

```yaml
  1-1-scan-a-tool-call-as-one-readable-row: backlog
```

to:

```yaml
  1-1-scan-a-tool-call-as-one-readable-row: done
```

- [ ] **Step 6: Run the full pre-PR gate**

Run: `bun run validate`
Expected: every step passes (`type-check`, `lint --max-warnings 0`, `format:check`, and the full `test` leg).

- [ ] **Step 7: Record the characterization evidence (issue #174 closing AC)**

`bun run validate` output prints to the terminal and is not durable, so write a summary the reviewer can read after the fact.
Create `_bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md` with: the date, the commit range for this story, the per-leg passing test counts from the `bun --filter @archon/web test` run (`src/lib`, `src/components`, `src/experiments/console`), and a one-line map from each Story 1.1 acceptance criterion to the test(s) that cover it. For example:

```markdown
# ANR 1.1 — Scan a tool call as one readable row — evidence

Date: <local date>
Commits: <first sha>..<last sha>

## Test runs (bun --filter @archon/web test)
- src/lib/tool-presentation.test.ts — <N> pass
- src/lib/agent-history.test.ts — <N> pass
- src/components/workflows/NodeRoom.test.tsx — <N> pass
- src/experiments/console/components/ConsoleNodeRoom.test.tsx — <N> pass
- bun run validate — all steps pass

## AC → coverage
- one-row render / collapsed-success / expanded-failed → NodeRoom + ConsoleNodeRoom "collapsed tool row"
- five-outcome expansion table → agent-history "initialToolExpanded"
- colour-independent glyphs / chip rule → agent-history "STATUS_GLYPH" + tool-presentation "chip rule"
- safe degradation / bounded algorithms → tool-presentation "generic fallback and safe degradation"
- interrupted status fold → agent-history "interrupted status fold"
```

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/agent-history.ts packages/web/src/lib/agent-history.test.ts packages/web/src/components/workflows/NodeRoom.test.tsx _bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml _bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md
git commit -m "refactor(web): drop superseded toolContext, record ANR 1.1 evidence, mark done"
```

---

## Acceptance Criteria → Task Map

Story 1.1's acceptance criteria (`epics.md:208-234`) and their coverage:

- Each call renders as one row with chevron, family chip, status glyph, salient headline, right-aligned badges; success collapsed, failed expanded, no serialized punctuation collapsed. → Tasks 3, 4 (renderer tests) on `initialToolExpanded` (Task 2) + resolver (Task 1).
- Five outcomes drive initial expansion `collapsed, expanded, collapsed, collapsed, collapsed`, covered by one focused test table. → Task 2 `initialToolExpanded` test.
- Status meaning available without colour via `✓ ✕ ◐ ⚠ –`; chip is the sent tool name only when one token of ≤24 chars, else the family name. → Task 2 `STATUS_GLYPH` test + Task 1 chip-rule tests + Tasks 3/4 glyph-character assertions.
- Malformed/adversarial payloads degrade to a safe generic row without throwing; every bounded algorithm terminates. → Task 1 safe-degradation tests (null/array/empty/`__proto__`/100k source; bounded routines: 80-char cut, first-non-empty-line, wrapper strip, ≤3 fields).
- An interrupted status row immediately after a tool call folds into the preceding call and renders `⚠ interrupted`. → Task 2 `foldInterruptedStatus` tests (non-Claude fixture) + `STATUS_GLYPH['interrupted'] === '⚠'`.

Issue #174 closing criteria:
- Story 1.1 acceptance criteria satisfied → all tasks.
- Focused tests / characterization evidence recorded before close → Task 5 Step 6 (`bun run validate` output).
- `sprint-status.yaml` entry moved to `done` → Task 5 Step 5.

## Validation Commands

- Per-module during TDD: `bun test packages/web/src/lib/tool-presentation.test.ts`; `bun test packages/web/src/lib/agent-history.test.ts`.
- Per-renderer during TDD: `NODE_ENV=development bun test packages/web/src/components/workflows/NodeRoom.test.tsx`; `NODE_ENV=development bun test packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`.
- Boundary: `bun test packages/web/src/experiments/console/console-isolation.test.ts`.
- Package gate: `bun --filter @archon/web type-check` and `bun --filter @archon/web test`.
- Pre-PR gate (required): `bun run validate`.

## Self-Review Notes

Spec coverage: every Story 1.1 AC maps to a task above; CAP-2/3/4/5/6/7 requirements in `tool-presentation-contract.md` are explicitly deferred to Stories 1.2–1.7 and listed under Non-Goals.
Type consistency: `ToolFamily`, `ToolPresentation`, and the `body` union are defined once in `tool-presentation.ts` and imported everywhere; `ToolOutcome`, `STATUS_GLYPH`, `initialToolExpanded`, `toolBadges`, and `ToolBadge` are defined once in `agent-history.ts`; both renderers use the same helper names (`glyphColor`, `badgeClass`, `Headline`) with only the `running` token differing per surface.
Live re-render semantics: `useState(initialToolExpanded(item.outcome))` sets expansion at mount only, per the AC's "when the transcript first renders"; a row that flips `running → failed` after mount stays collapsed by design, not a bug.
No placeholders: every code and test step carries the actual content; the one deliberately-awkward Step 1 assertion in Task 1 is replaced with its exact form in Step 4 of the same task.
