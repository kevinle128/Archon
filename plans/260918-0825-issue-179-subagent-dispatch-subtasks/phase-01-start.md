---
phase: 1
title: 'Phase 1: Shared task contract and red unit tests'
status: todo
priority: P1
effort: '3h'
dependencies: []
---

# Phase 1: Shared task contract and red unit tests

## Goal

Produce the one shared, React-free contract both renderers consume: `normalizeTaskDispatch()` in a new `lib/task-normalize.ts`, and `ToolPresentation.body` (task arm only) plus the `N subagent(s)` badge in `tool-presentation.ts` — test-first, bounded, never throwing.

## Context links

- Plan index: [plan.md](./plan.md) — read "Resolved source conflicts and decisions" first; every rule below is one of them.
- Scout report: [reports/scout-report.md](./reports/scout-report.md).
- Contract: `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md:44-52` (`body` union, `TaskSubtask`), `:214-226` (normalizer table).
- Test plan: `_bmad-output/specs/spec-agent-node-room/test-plan.md:55-59`.
- Existing patterns to mirror (none of these are exported, and `task-normalize.ts` must not import from `tool-presentation.ts`): `tool-presentation.ts:159-164` `asRecord`, `:166-170` `stringField`, `:274-285` `truncateCodePoints` (code-point-safe truncation). `firstNonEmptyLine` (`:256-272`) is **not** a fit: it rejects an over-cap source outright, whereas the excerpt needs a bounded scan window followed by a hard length cap. The normalizer carries its own small copies. <!-- Updated: Red Team 2026-09-18 — findings A1/S4 -->

## Key insights

- `toolPresentation()` already wraps resolution in try/catch (`tool-presentation.ts:522-528`); assembling the body inside `resolveToolPresentation` (`:419-511`, `case 'task'` at `:481`) inherits that guarantee. The normalizer still must not throw on its own, because Phase 2 tests call it directly and a future caller (chat card) may too.
- `task-normalize.ts` must import nothing from `tool-presentation.ts` (that file imports the normalizer) — copy the record and code-point helpers locally rather than creating a cycle; extraction into a shared helper waits for the rule of three.
- Preflight before writing the red tests: confirm the two provider shapes against the installed SDKs, not only the spec prose — Claude `AgentInput` in `@anthropic-ai/claude-agent-sdk`'s `sdk-tools.d.ts` (`description`, `prompt`, `subagent_type?`) and the OMP dispatch tool's `{ context, tasks: [{ name, agent, task }] }` in the OMP/Pi package under `node_modules` (read from the implementing session; the planning session's hook blocked that path). Record both citations in the PR. <!-- Updated: Red Team 2026-09-18 — finding A4 -->
- `taskHeadline` (`:384-396`) stays as shipped; its `description` preference is already tested (`tool-presentation.test.ts:357-364`).

## File inventory

| Path | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/web/src/lib/task-normalize.ts` | Create | ~120 lines | New file `task-normalize.test.ts` |
| `packages/web/src/lib/task-normalize.test.ts` | Create | ~150 lines | CAP-4 table, precedence, malformed, bounded, never-throws |
| `packages/web/src/lib/tool-presentation.ts` | Modify | +~35 lines | `tool-presentation.test.ts` |
| `packages/web/src/lib/tool-presentation.test.ts` | Modify | +~60 lines | `body` for task, `body: null` sweep, badge singular/plural |
| `packages/web/src/lib/agent-history.test.ts` | Modify | +~20 lines | One tool card carrying a dispatch exposes `presentation.body` |

## Contract to implement

```ts
// packages/web/src/lib/task-normalize.ts
export const MAX_TASK_SUBTASKS = 64;
export const MAX_TASK_EXCERPT_SOURCE_CODE_UNITS = 4096; // scan window for the first non-empty line
export const MAX_TASK_EXCERPT_CODE_POINTS = 160;        // hard cap on the one-line excerpt
export const MAX_TASK_TEXT_CODE_POINTS = 65536;         // cap on `prompt` and `context` as rendered

export interface TaskSubtask {
  name: string;          // OMP `name`; Claude `description` or ''
  agent: string | null;  // OMP `agent`; Claude `subagent_type`; null when absent/non-string/empty
  prompt: string;        // OMP `task`; Claude `prompt` — at most MAX_TASK_TEXT_CODE_POINTS, `…` when cut
  excerpt: string;       // first non-empty line inside the scan window, cut to MAX_TASK_EXCERPT_CODE_POINTS, `…` when anything follows; '' when none
}

export interface TaskDispatch {
  context: string | null;   // OMP `context` when a non-empty string (same text cap); Claude always null
  subtasks: TaskSubtask[];  // at least one entry
  unscanned: number;        // elements past MAX_TASK_SUBTASKS — real dispatches the reader cannot see
  dropped: number;          // malformed elements skipped — never valid dispatches
}

export function normalizeTaskDispatch(input: unknown): TaskDispatch | null;
```

Resolution order inside `normalizeTaskDispatch`:

1. `input` must be a plain record (not null, not array) — else `null`.
2. If `record.tasks` is an array → OMP batch. Iterate with `for (let i = 0; i < Math.min(tasks.length, MAX_TASK_SUBTASKS); i++)`. Element qualifies when it is a record with string `name` and string `task`; `agent` is a non-empty string or `null`. Non-qualifying elements increment `dropped`. `unscanned = tasks.length - scanned`. Zero qualifying → `null`.
3. Else if `record.prompt` is a string → Claude single: one entry `{ name: nonEmptyString(description) ?? '', agent: nonEmptyString(subagent_type), prompt, excerpt }`, `context: null`, `unscanned: 0`, `dropped: 0`.
4. Else `null`.
5. `context` (OMP only): `typeof record.context === 'string' && record.context.trim().length > 0 ? boundedText(record.context) : null`.
6. `boundedText(value)`: code-point-safe truncation to `MAX_TASK_TEXT_CODE_POINTS` with a trailing `…` when cut (local copy of the `truncateCodePoints` technique — iterate with `for (const char of value)`, never `String.prototype.slice`, so a surrogate pair is never split). Applied to `prompt` and `context`; `name` and `agent` are identifiers and get the same helper at 200 code points.
7. `excerpt(prompt)`: scan at most `MAX_TASK_EXCERPT_SOURCE_CODE_UNITS` leading code units for the first non-empty trimmed line (a bounded scan window, not a display length); if none → `''`; cut that line to `MAX_TASK_EXCERPT_CODE_POINTS` code points; append `…` when the line was cut, when later non-empty text exists in the window, or when the prompt exceeds the window. The result is always a genuine one-liner suitable for a `<summary>` accessible name.
8. Wrap the body in `try { … } catch { return null; }` — a hostile getter or exotic object must degrade, not throw.

```ts
// packages/web/src/lib/tool-presentation.ts additions
import { normalizeTaskDispatch, type TaskSubtask } from './task-normalize';

export type ToolBody = {
  kind: 'task';
  context: string | null;
  subtasks: TaskSubtask[];
  unscanned: number;
  dropped: number;
};
// Other family arms (terminal, diff, matches, paths, code, web, generic) arrive with Story 1.3.

export interface ToolPresentation {
  …existing fields…
  /** Family body arm, or null when no arm exists yet — renderers then show the bar-only body. */
  body: ToolBody | null;
}
```

In `resolveToolPresentation`, `case 'task'`: after `headline = taskHeadline(record)`, call `normalizeTaskDispatch(input.input)`; when non-null set `body = { kind: 'task', ...dispatch }` and push `{ kind: 'count', text: subagentBadgeText(n), tone: 'neutral' }` where `n = subtasks.length + unscanned` — malformed `dropped` elements were never dispatches and are not counted — and the text is `1 subagent` / `${n} subagents`. Every other family sets `body: null`. `safePresentation` (`:506-520`) returns `body: null` on both paths. The `mcp` early return (`:424-434`) also sets `body: null`.

`ToolRowPresentation extends ToolPresentation` so the field reaches `AgentHistoryItem.presentation` with no change to `agent-history.ts`.

## Tests before (red first)

### `task-normalize.test.ts`

| Case | Input | Expected |
| --- | --- | --- |
| OMP batch (test-plan `:56`) | `{ context: 'Read-only.', tasks: [{ name: 'A', agent: 'scout', task: 'p1' }, { name: 'B', agent: 'scout', task: 'p2\nmore' }] }` | 2 subtasks, `context: 'Read-only.'`, `unscanned: 0`, `dropped: 0`, `subtasks[1].excerpt === 'p2…'` |
| Claude single (`:57`) | `{ description: 'Scout', prompt: 'Find callers', subagent_type: 'Explore' }` | 1 subtask `{ name: 'Scout', agent: 'Explore', prompt: 'Find callers', excerpt: 'Find callers' }`, `context: null` |
| Claude without agent (`:58`) | `{ description: 'Scout', prompt: 'x' }` | `agent: null` |
| Claude without description | `{ prompt: 'x' }` | `name: ''` |
| Precedence | `{ description: 'd', prompt: 'p', tasks: [{ name: 'n', task: 't' }] }` | OMP wins: 1 subtask named `n` |
| Empty/blank context | `{ context: '   ', tasks: [...] }` | `context: null` |
| Non-string agent | `{ tasks: [{ name: 'n', agent: 7, task: 't' }] }` | `agent: null` |
| Malformed elements dropped | `{ tasks: [null, 'str', { name: 'ok', task: 't' }, { name: 'no-task' }] }` | 1 subtask, `dropped: 3`, `unscanned: 0` |
| All malformed | `{ tasks: [null, {}] }` | `null` |
| Empty array | `{ tasks: [] }` | `null` |
| Cap | `{ tasks: Array.from({ length: 100 }, (_, i) => ({ name: String(i), task: 't' })) }` | `subtasks.length === 64`, `unscanned === 36`, `dropped === 0` |
| Cap plus malformed | 70 elements, 5 malformed within the first 64 | `subtasks.length === 59`, `dropped === 5`, `unscanned === 6` |
| Excerpt: leading blank lines | `prompt: '\n\n  first\nsecond'` | `excerpt: 'first…'` |
| Excerpt: single line | `prompt: 'only'` | `excerpt: 'only'` |
| Excerpt: whitespace-only prompt | `prompt: '  \n '` | `excerpt: ''` |
| Excerpt: long single line | `'a'.repeat(5000)` | `excerpt === 'a'.repeat(160) + '…'`, `prompt.length === 5000` |
| Excerpt: exactly at cap | `'a'.repeat(160)` | `excerpt === 'a'.repeat(160)` (no `…`) |
| Excerpt: surrogate pair at the cut | 159 `a` then `'😀'` then `'b'` | excerpt ends with the whole `😀` followed by `…`; no lone surrogate (`/[\uD800-\uDFFF]/` never matches an isolated unit) |
| Text cap | `prompt: 'x'.repeat(70000)` | `prompt === 'x'.repeat(65536) + '…'`; same for `context` |
| Text cap with surrogates | 65535 `a` then `'😀😀'` | cut lands on a code-point boundary |
| Not a record | `undefined`, `null`, `'str'`, `[]`, `42` | `null` |
| Hostile getter | object whose `tasks` getter throws | `null`, no throw |
| Determinism | same input twice | `toEqual` |

### `tool-presentation.test.ts`

- `call('Task', claudeInput).body` equals `{ kind: 'task', context: null, subtasks: [...], unscanned: 0, dropped: 0 }`; `contentBadges` contains `{ kind: 'count', text: '1 subagent', tone: 'neutral' }`.
- `call('task', ompInput).body.subtasks.length === 2`; badge text `2 subagents`.
- Badge counts unscanned but not dropped: 70 valid elements → `70 subagents`; `[valid, null, null]` → `1 subagent` with `dropped: 2`.
- `call('task', { garbage: true }).body === null` and no count badge; `headline` is the chip label (unchanged 1.1 behaviour).
- Sweep: for one representative input per non-task family (`bash`, `Read`, `Grep`, `Glob`, `eval`, `todo`, `WebFetch`, `mcp__s__t`, unknown) `body === null`.
- `toolRowPresentation(...).body` is the same value as `toolPresentation(...).body`, and the `N subagents` badge sits in `badges` before `exit`/`duration` (existing content-badge order).
- `safePresentation` path (name is not a string) → `body: null`.

### `agent-history.test.ts`

- A `tool` row `{ name: 'Task', id: 't1', input: claudeInput }` paired with its result → the item's `presentation.body?.kind === 'task'` and `presentation.badges` includes `1 subagent`.

Run before implementing; every new case must fail for the right reason (missing module / missing field), not for a typo:

```bash
cd packages/web && bun test src/lib/task-normalize.test.ts src/lib/tool-presentation.test.ts src/lib/agent-history.test.ts
```

## Refactor (protected changes)

1. Create `task-normalize.ts` per the contract above; docblock states it is provider-shape → shared-shape only, React-free, and imports nothing from `tool-presentation.ts`.
2. Add `ToolBody`, `body` to `ToolPresentation`, the task-arm assembly and badge in `case 'task'`, `body: null` in the `mcp` return and both `safePresentation` returns.
3. Do not touch `taskHeadline`, alias tables, or any other family branch.

## Tests after

- All Phase 1 tests green; the whole `src/lib/` suite green (existing 1.1 tables unchanged).
- `bun run type-check` in `packages/web` green — the two renderers compile untouched because `body` is additive and they never destructure `ToolPresentation` exhaustively.

## Regression gate

```bash
cd packages/web && bun test src/lib/ && bun run type-check
```

## Test scenario matrix

| Priority | Scenario | Test |
| --- | --- | --- |
| Critical | Both provider shapes normalize (AC1) | `task-normalize.test.ts` rows 1–3 |
| Critical | Malformed never throws, degrades to `null` (AC3) | rows "All malformed", "Not a record", "Hostile getter"; `tool-presentation.test.ts` garbage case |
| Critical | Bounded scan with surfaced cap; bounded text | rows "Cap", "Cap plus malformed", "Text cap" rows |
| High | Precedence and field fallbacks | rows "Precedence", "Claude without description", "Non-string agent" |
| High | Excerpt semantics incl. 160-code-point cap and surrogate safety | seven excerpt rows |
| High | Badge singular/plural; counts `unscanned`, never `dropped` | `tool-presentation.test.ts` |
| Medium | `body: null` for every other family | sweep |
| Medium | Item-level plumbing | `agent-history.test.ts` |

## Dependency map

- Produces: `TaskSubtask`, `TaskDispatch`, `ToolBody`, `ToolPresentation.body`, `N subagent(s)` badge → consumed by Phase 2 renderers.
- Consumes: Story 1.1 helpers in `tool-presentation.ts`; `AgentHistoryItem.presentation` plumbing in `agent-history.ts:186-189` (unchanged).
- Coordinates with: Story 1.3 will extend `ToolBody` with the remaining arms; keep the union in one exported type so that extension is additive.

## Todo

- [ ] Write `task-normalize.test.ts` (red).
- [ ] Extend `tool-presentation.test.ts` and `agent-history.test.ts` (red).
- [ ] Implement `task-normalize.ts`.
- [ ] Add `ToolBody`/`body`/badge to `tool-presentation.ts`.
- [ ] `cd packages/web && bun test src/lib/ && bun run type-check` green.

## Success criteria

All rows of the scenario matrix pass; no renderer file changed in this phase; `ToolPresentation.body` is `null` for every non-task presentation and for every failed task normalization.

## Risk assessment

- Circular import between `task-normalize.ts` and `tool-presentation.ts` → keep the normalizer dependency-free (local helpers).
- Story 1.3 lands first and adds `body` with a different shape → this phase's union is the contract's shape; rebase onto theirs, keeping the task arm and the `unscanned`/`dropped` counts.
- `unscanned`/`dropped` tempt a "silent cap" → both counts are part of the arm and Phase 2 renders each.
- A 4096-code-unit excerpt would leak near-whole single-line prompts into the always-present `<summary>` accessible name → the 160-code-point cap is the fix; the 4096 window only bounds the newline search.

## Security considerations

Pure data transformation on already-authorized payloads; no HTML, no `dangerouslySetInnerHTML`, no attribute injection. Bounded loops, code-point-safe caps on every emitted string (`prompt`/`context` 65536, `excerpt` 160, `name`/`agent` 200), and try/catch protect the transcript from hostile stored payloads: a multi-megabyte `task` string cannot force an unbounded `<pre>` layout.

## Next steps

Phase 2 consumes `presentation.body` on both surfaces. Before starting it, run the deep-mode scout pass: re-verify the body-region line numbers in both renderers against the current `develop` (Story 1.2 may have moved them).
