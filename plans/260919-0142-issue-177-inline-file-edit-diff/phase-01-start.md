---
phase: 1
title: 'Phase 1: Bounded differ, adapter move, presentation contract'
status: pending
priority: P1
effort: '1.5d'
dependencies: []
---

# Phase 1: Bounded differ, adapter move, presentation contract

## Goal

Add the pure, React-free line-diff module the contract names, move the existing hunk adapter into `lib/` so both surfaces can use it, and teach `tool-presentation.ts` to detect a two-sided file edit, expose `+n −m` badges and hunk facts on the summary row, and carry the hunks on the lazy file body. Everything in this phase is testable with `bun test` in `packages/web/src/lib/` and needs no DOM.

## Required reading

- `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md` — "Expanded body" table (`file` row), "Badges", "Body bar", and the whole "Inline diff" section.
- `_bmad-output/specs/spec-agent-node-room/test-plan.md` — `diff-hunks.test.ts` bullets, the CAP-5 line under `tool-presentation.test.ts`, and "Boundary checks".
- `packages/web/src/lib/tool-presentation.ts` — `BEFORE_AFTER_PAIRS`, the `file` case in `toolPresentation()`, `toolRowPresentation()` (body-bar composition), `resolveToolBody()` `file` arm, `ToolRowBadgeKind`/`ToolRowBadgeTone`.
- `packages/web/src/components/workflows/source-control/git-hunk-adapter.ts` and its test.
- `plans/260919-0142-issue-177-inline-file-edit-diff/reports/research-jsdiff-9.md` — the `structuredPatch` facts this phase relies on.

## Files

| Path                                                                        | Action                                                                      |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/web/package.json`                                                 | add `"diff": "9.0.0"` to `dependencies` (exact pin); run `bun install`      |
| `bun.lock`                                                                  | updated by `bun install`                                                    |
| `packages/web/src/lib/diff-hunks.ts`                                        | create                                                                      |
| `packages/web/src/lib/diff-hunks.test.ts`                                   | create                                                                      |
| `packages/web/src/lib/git-hunk-adapter.ts`                                  | `git mv` from `components/workflows/source-control/`; retarget type imports |
| `packages/web/src/lib/git-hunk-adapter.test.ts`                             | `git mv` alongside; update its relative import                              |
| `packages/web/src/components/workflows/source-control/virtualized-diff.tsx` | `import { hunksForSide, toHunkData } from '@/lib/git-hunk-adapter'`         |
| `packages/web/src/lib/tool-presentation.ts`                                 | pair detection, badges, facts, body `diff`, new kind/tone                   |
| `packages/web/src/lib/tool-presentation.test.ts`                            | new tables                                                                  |
| `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`     | update the `file` arm row, "Badges", "Body bar", and "Inline diff"          |
| `_bmad-output/specs/spec-agent-node-room/test-plan.md`                      | align bullets with the tests actually written                               |

## Contract to implement

### `diff-hunks.ts`

```ts
import { structuredPatch } from 'diff';
import type { components } from '@/lib/api.generated';

type GitDiffHunk = components['schemas']['GitDiffHunk'];
type GitDiffChange = components['schemas']['GitDiffChange'];

/** Either side above this many UTF-8 bytes is refused before any diff work. */
export const MAX_DIFF_SIDE_BYTES = 65_536;
/** Either side with more lines than this is refused; bounds the Myers edit graph (N+M) independently of bytes. */
export const MAX_DIFF_SIDE_LINES = 2_000;
/** Passed to jsdiff as `maxEditLength`; a pair needing more edits is refused. */
export const MAX_DIFF_EDIT_LENGTH = 2_000;
/** Context lines around each change (git's default), fixed here so results are stable. */
export const DIFF_CONTEXT_LINES = 3;
/** Memo entries retained by the default instance; least-recently-used evicted first. */
export const DIFF_MEMO_ENTRIES = 256;

export interface DiffHunksResult {
  hunks: GitDiffHunk[];
  /** Count of `insert` changes across all hunks. */
  added: number;
  /** Count of `delete` changes across all hunks. */
  deleted: number;
}

export type DiffHunksFn = (before: string, after: string) => DiffHunksResult | null;

/** Builds an independent memoizing instance; tests use small `memoEntries` and may inject `patch`. */
export function createDiffHunks(options?: {
  memoEntries?: number;
  patch?: typeof structuredPatch;
}): DiffHunksFn;

/** The shared instance every production caller uses. */
export const diffHunks: DiffHunksFn;
```

Rules the implementation must obey:

1. **Free pre-check first.** If `before.length > MAX_DIFF_SIDE_BYTES` or `after.length > MAX_DIFF_SIDE_BYTES`, return `null` immediately without touching the memo (a string's UTF-8 byte length is never smaller than its UTF-16 code-unit length, so this is O(1) and honest).
2. **Memo on the pair, LRU.** Key is `String(before.length) + ':' + before + after` in an insertion-ordered `Map<string, DiffHunksResult | null>`. Look the key up **before** any O(n) work: a hit deletes and re-inserts the entry (LRU refresh) and returns the stored object itself (so `toBe` holds). On a miss, measure `new TextEncoder().encode(side).byteLength` for each side and store `null` if either exceeds the ceiling; then count `\n` per side and store `null` if either side exceeds `MAX_DIFF_SIDE_LINES` (with 64 KiB of one-character lines the Myers graph is ~65K × 2,000 steps; the line ceiling caps it at ~4K × 2,000 — security finding 3); otherwise compute, store, and evict the oldest entry while `size > memoEntries`. Every outcome — hunks, byte refusal, edit-length refusal, throw — is memoized, so a pathological pair costs its O(n) work once per eviction window (red-team finding 2).
3. **Fixed options.** `structuredPatch('', '', before, after, undefined, undefined, { context: DIFF_CONTEXT_LINES, maxEditLength: MAX_DIFF_EDIT_LENGTH })`. Wrap in `try/catch`; `undefined` (bound exceeded) and any throw both become `null`. No `timeout`, no `ignoreWhitespace`, no `stripTrailingCr`, never `newlineIsToken`.
4. **Walk the lines.** For each hunk, `let oldLine = hunk.oldStart; let newLine = hunk.newStart;` then for each entry of `hunk.lines`: prefix `\` → skip, advance nothing; ` ` → emit `{ type: 'normal', content, oldLine, newLine }` and advance both; `-` → `{ type: 'delete', content, oldLine }` and advance old; `+` → `{ type: 'insert', content, newLine }` and advance new. `content` is the entry without its one-character prefix. Any other prefix is a contract violation: throw inside the try so the pair becomes `null`.
5. **Synthesize the header** `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@` from jsdiff's numbers (they exclude the marker entries, as verified).
6. **Sum `added`/`deleted`** from the emitted changes, not from jsdiff counts.
7. Pure module: no React, no DOM, no logging, no provider names.

### `git-hunk-adapter.ts` (moved, logic unchanged)

Replace `import type { GitDiffChange, GitDiffHunk } from '@/lib/api';` with the same aliases derived from `import type { components } from '@/lib/api.generated';`. Nothing else changes; `requiredLine()` keeps throwing on a non-integer or `< 1` line number. The test file moves with it and keeps every existing case.

### `tool-presentation.ts`

- `ToolRowBadgeKind` gains `'diff'`; `ToolRowBadgeTone` gains `'success'`.
- Add `import { diffHunks, type DiffHunksResult } from './diff-hunks';` and export `type FileDiff = DiffHunksResult` for renderer consumption via the existing `@/lib/tool-presentation` import.
- Add a module-level `const FILE_DIFF_BY_RECORD = new WeakMap<object, DiffHunksResult | null>();` and a private `fileDiffFor(record): DiffHunksResult | null` that returns the cached value for the record object when present, otherwise computes `pair === null ? null : diffHunks(pair.before, pair.after)`, stores it, and returns it. Both the summary path and the body arm call `fileDiffFor(record)`. The record is the stored row's `payload.input` object, which is stable across renders (`buildAgentHistory` runs in the render body at three sites — see plan decision 2), so a re-render costs one identity lookup; a poll that re-parses rows falls through to the string-keyed LRU in `diff-hunks.ts`. A non-object input never reaches the WeakMap.
- Add a private `fileEditPair(record): { before: string; after: string } | null` that scans `BEFORE_AFTER_PAIRS` in order and returns the first pair whose **both** keys are own-property strings — use `Object.hasOwn(record, key)` explicitly rather than bracket access, since `inferFamily` reads through the prototype chain (security finding 6). Empty string is a string. No new key list. Test: an object whose `old_string`/`new_string` live on its prototype yields no pair.
- `toolPresentation()` `file` case, after the headline: `const pair = fileEditPair(record); const diff = pair === null ? null : diffHunks(pair.before, pair.after);` then
  - `diff !== null && diff.added > 0` → push `{ kind: 'diff', text: '+' + String(diff.added), tone: 'success' }`;
  - `diff !== null && diff.deleted > 0` → push `{ kind: 'diff', text: '−' + String(diff.deleted), tone: 'danger' }` (the `−` is U+2212 MINUS SIGN, matching the design's `−m`);
  - `bodyFacts`: `diff === null` → `[]`; `diff.hunks.length === 0` → `['no changes']`; else `[`${n} hunk` + (n === 1 ? '' : 's')]`; then append `replace_all: true|false` when `record.replace_all` is a boolean.
  - `body` stays `null` here — the hunks ride the lazy arm.
- `toolRowPresentation()`: replace `...(isTaskBody ? content.bodyFacts : [])` with `...content.bodyFacts` (only task and file rows populate it) and extend the badge filter to drop `badge.kind === 'diff'` from `barBadges`. Everything else in the bar is unchanged, so existing bar tests keep passing.
- `resolveToolBody()` `file` case: `diff: fileDiffFor(record)` (a WeakMap hit), returning `{ kind: 'file', path, preview, unreadable, diff }`. The `ToolBody` file member becomes `{ kind: 'file'; path: string; preview: string | null; unreadable: boolean; diff: FileDiff | null }`. Preview computation is untouched. The existing strict `toEqual` in `tool-presentation.test.ts` `describe('file body')` (~line 1262) must gain `diff: null` — it is the one pre-existing assertion this field changes (red-team finding 4).
- The diff is **computed** on the raw sides (sanitizing before diffing would misreport what changed), but every emitted change `content` passes through the existing `sanitizeBounded(content, MAX_LIST_ITEM_TEXT_CODE_UNITS)` from `tool-output.ts` inside `diff-hunks.ts`'s walk, with the ellipsis marker on truncation. This strips `\r`, ANSI/OSC sequences, and other control characters that would otherwise survive jsdiff's line split and, under `pre-wrap`, could fake a line break inside one numbered diff line — a Trojan-Source-class deception on a surface used for human approval (security finding 5). Test: a side containing `'a\rb'` and an OSC-8 sequence renders as one line with the sequence removed; the `−`/`+` counts are unaffected.

## Tests first

### `diff-hunks.test.ts`

Use a fresh `createDiffHunks({ memoEntries: 2 })` per test unless the case is about the default instance. Assert exact `GitDiffHunk[]` values, not snapshots.

| Case                                                | Input                                                                         | Expected                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mockup fixture: two lines changed in a 4-line snippet | before/after from the states-sheet `backoff` example                          | one hunk `@@ -1,4 +1,4 @@`; changes: normal(1,1), delete(2), delete(3), insert(2), insert(3), normal(4,4) — or deletes/inserts interleaved exactly as jsdiff emits; assert the multiset and the counters, `added: 2`, `deleted: 2`               |
| marker **mid-array**                                | `'a\nb'` → `'a\nb\n'`                                                         | jsdiff emits ` a`, `-b`, `\ No newline…`, `+b`; expect normal(1,1), delete(oldLine 2), insert(newLine 2); the marker advances no counter; header `@@ -1,2 +1,2 @@`                                                                              |
| marker **twice** in one hunk                        | `'x\ny'` → `'x\nz'` (both sides lack a trailing newline, last line changed)   | ` x`, `-y`, `\…`, `+z`, `\…`; expect normal(1,1), delete(2), insert(2); `added: 1`, `deleted: 1`; assert no change has `content` starting with `\`                                                                                              |
| multiple hunks                                      | 20-line before; change line 2 and line 19                                     | two hunks; second hunk's `oldStart`/`newStart` equal the hand-computed values with `DIFF_CONTEXT_LINES` context; every `normal` change has `newLine - oldLine` constant within a hunk                                                           |
| identical inputs                                    | `'same\n'` twice                                                              | `{ hunks: [], added: 0, deleted: 0 }`, not `null`                                                                                                                                                                                              |
| empty before                                        | `''` → `'new\n'`                                                              | one hunk, one `insert` with `newLine: 1`; `oldLines: 0`                                                                                                                                                                                        |
| empty after                                         | `'old\n'` → `''`                                                              | one hunk, one `delete` with `oldLine: 1`; `newLines: 0`                                                                                                                                                                                        |
| byte ceiling, code-unit pre-check                   | `'a'.repeat(MAX_DIFF_SIDE_BYTES + 1)` vs `''`                                 | `null`; the injected patch function (see note) is not invoked                                                                                                                                                                                  |
| byte ceiling, multibyte                             | `'é'.repeat(MAX_DIFF_SIDE_BYTES / 2 + 1)` (fits in code units, exceeds bytes) | `null`; and `'é'.repeat(MAX_DIFF_SIDE_BYTES / 2)` (exactly at the ceiling) is **not** refused                                                                                                                                                  |
| line ceiling                                        | `'a\n'.repeat(MAX_DIFF_SIDE_LINES + 1)` vs `''`                             | `null`, patch not invoked; `'a\n'.repeat(MAX_DIFF_SIDE_LINES)` is **not** refused                                                                                                                                                           |
| edit-length bound                                   | `MAX_DIFF_EDIT_LENGTH + 1` distinct lines → all replaced                      | `null`, returns promptly (no timeout involved); a pair needing exactly `MAX_DIFF_EDIT_LENGTH` edits is **not** refused (limit vs limit + 1)                                                                                                     |
| determinism and memo identity                       | same pair twice                                                               | second result `toBe` the first (same object); on a `memoEntries: 2` instance, pairs A, B, then A again (refresh), then C evicts **B** not A — A is still `toBe` its original, B returns an equal but `not.toBe` object (LRU, not FIFO)               |
| refusal is memoized                                 | over-ceiling pair twice                                                       | both `null`; the injected patch function is never entered                                                                                                                                                                                      |
| CRLF honesty                                        | `'a\r\nb\r\n'` → `'a\nb\n'`                                                   | every line reported changed (2 deletes, 2 inserts); no option silently normalizes                                                                                                                                                              |
| feeds the adapter                                   | every produced hunk above                                                     | `toHunkData(hunk)` does not throw and each `ChangeData` has a positive integer line number                                                                                                                                                     |
| throw becomes `null`                                | a factory instance whose patch function throws                                | `null`, nothing propagates                                                                                                                                                                                                                     |

Implementation note for the spy rows: the `patch` option on `createDiffHunks` (defaulting to `structuredPatch`) is how tests count or fail calls without `mock.module('diff')` — `mock.module` is process-global and irreversible in this repo's test model. The default instance never sets it. Add one more row: **multibyte refusal is memoized** — call the over-byte `'é'` pair twice on an instance whose `patch` counts calls and whose `TextEncoder` usage you observe by wrapping the pair in a fresh instance; the second call must not repeat the O(n) encode (assert via a counting `patch` that neither call reached it and, if you expose nothing else, by timing-free structural means: the key is present in the map after the first call — a small `size()` accessor on the factory result is acceptable for this).

### `git-hunk-adapter.test.ts` (moved)

All existing cases pass unchanged from the new location. Keep the file green; the structural "types come from `api.generated`" check is owned by the Phase 2 boundary test.

### `tool-presentation.test.ts`

Add a `describe('file edit diff')` block:

- `toolPresentation({ name: 'Edit', input: { file_path: 'a.ts', old_string: 'x\n', new_string: 'y\n', replace_all: false }, output: undefined })` → `family: 'file'`, `contentBadges` contains `{ kind: 'diff', text: '+1', tone: 'success' }` and `{ kind: 'diff', text: '−1', tone: 'danger' }` (U+2212), `bodyFacts` equals `['1 hunk', 'replace_all: false']`.
- `old_str`/`new_str` and `content`/`new_content` pairs produce the same badges (table over `BEFORE_AFTER_PAIRS`).
- Empty `new_string` (`''`) is a present side: `old_string: 'gone\n', new_string: ''` → `−1`, no `+` badge, `bodyFacts: ['1 hunk']`.
- Identical sides → no `diff` badges, `bodyFacts: ['no changes']`.
- One-sided (`Write` with `content` only), no input (`{ name: 'edit', input: undefined }`), and a `file` row whose pair is refused (one side above `MAX_DIFF_SIDE_BYTES`) → no `diff` badges, `bodyFacts: []`, and `toolBodyPresentation(...).diff === null` with today's `preview` behavior intact.
- Family invariance: the family for every row above equals the family computed with `output` omitted; a `shell`/`search` row carrying `old_string`/`new_string` keys inside a nested object gets no diff badge (pair detection reads own top-level keys only); and a row whose **alias** resolves to a non-file family (`Bash` with top-level `content`/`new_content`, `Grep` with `old_str`/`new_str`) gets no diff badge and no `diff` on its body, because the diff arm exists only inside the `file` case (red-team failure finding 5 — the `content`/`new_content` inference only fires for a name with no alias).
- `toolRowPresentation` body bar: `bodyBarText` for the first case with `{ outcome: 'succeeded', durationMs: 41 }` is exactly `'file · 1 hunk · replace_all: false · 41ms'` — the `diff` badges are absent from the bar while `badges` still contains them; an existing task-row bar assertion still passes.
- Memo reuse across summary and body: `toolBodyPresentation(edit, 'file').diff` is `toBe` the object returned by a second `toolBodyPresentation(edit, 'file')` call, and its `hunks` deep-equal `diffHunks(before, after).hunks` — proving both paths hit one memo entry.
- Render-cost proof: with `spyOn` on the `diff-hunks` module's default export wrapper (or by counting through a `createDiffHunks({ patch })` instance if a seam is exposed for tests — keep it internal), calling `toolPresentation` five times with the **same input object** invokes the string-keyed differ once; calling it with a **new object of equal strings** invokes the differ again but `structuredPatch` zero times (string LRU hit).
- Body-facts invariant: a table over shell, search, glob, code, web, generic, todo, and one-sided file rows asserts `bodyFacts` is `[]`, so the unconditional `...content.bodyFacts` in the bar stays behavior-preserving for every family except task and two-sided file (red-team finding 5).
- Malformed values (`old_string: 42`, `new_string: null`, a `Proxy` throwing on get) never throw and yield no badge.

## Source-contract corrections (same change)

`tool-presentation-contract.md`:

- "Expanded body" `file` row: "diff when before/after are present (both values strings; empty string counts), else path plus preview; on a non-succeeded outcome the output text renders beneath the diff".
- "Badges": `+n −m` are two `diff`-kind badges, `+n` in the success tone, `−m` (U+2212) in the danger tone, each omitted when zero; they never appear in the body bar.
- "Body bar": file facts are `N hunk(s)` or `no changes`, then `replace_all: <bool>` when present.
- "Inline diff": replace the paragraph on bounds with the concrete constants and the `null` semantics; add "identical sides return zero hunks, not null"; add "line numbers are snippet-relative (1-based) because `FileEditInput` carries no offset"; add the hunk-separator rule and the failed-edit rule; note the memo is keyed on the pair and shared by the summary and body paths, and that this is the sanctioned summary-time computation.

`test-plan.md` `diff-hunks.test.ts` section: add the identical-inputs, empty-side, CRLF, and eviction bullets; under `tool-presentation.test.ts` expand the CAP-5 bullet into the badge/facts/memo bullets above.

## Implementation order

1. Add `"diff": "9.0.0"` to `packages/web/package.json` `dependencies` and run `bun install` from the repo root; confirm `bun.lock` lists `"diff": "9.0.0"` under `@archon/web` and that `import { structuredPatch } from 'diff'` type-checks (v9 ships its own types).
2. `git mv` the adapter and its test into `src/lib/`; fix the three import sites; run `bun test src/lib/git-hunk-adapter.test.ts` and `NODE_ENV=development bun test src/components/workflows/source-control/`.
3. Write `diff-hunks.test.ts` (red), then `diff-hunks.ts` (green).
4. Write the `tool-presentation.test.ts` block (red), then the presentation changes (green). Fix any existing assertion that enumerated `ToolRowBadgeTone` members.
5. Add the two one-line `success` entries to both renderers' `BADGE_TONE` maps so `bun run type-check` stays green (Phase 2 owns the rest of the renderer work).
6. Update the two spec documents.
7. Run type-check, lint, and format on the touched files.

## Commands

```bash
cd packages/web && bun test src/lib/diff-hunks.test.ts src/lib/git-hunk-adapter.test.ts src/lib/tool-presentation.test.ts
cd packages/web && NODE_ENV=development bun test src/components/workflows/source-control/
bun run type-check
bun run lint
bun run format:check
```

## Exit criteria

- [ ] `diff@9.0.0` is an exact-pinned dependency of `@archon/web`; the lockfile resolves it there.
- [ ] `diff-hunks.ts` exists, exports the constants and factory above, and `grep -rn "structuredPatch" packages/web/src` matches only `lib/diff-hunks.ts` and `lib/diff-hunks.test.ts` (the test may name it when injecting the `patch` seam; no other file may).
- [ ] The adapter and its test live in `src/lib/`, import types from `api.generated`, and `virtualized-diff.tsx` compiles against the new path with the source-control tests green.
- [ ] Every table row in this phase has a passing test; `MAX_DIFF_SIDE_BYTES` and `MAX_DIFF_EDIT_LENGTH` are asserted at limit and limit + 1.
- [ ] `toolPresentation`/`toolRowPresentation`/`toolBodyPresentation` behave per the contract; all pre-existing `tool-presentation.test.ts` cases still pass.
- [ ] Contract and test-plan documents record decisions 2–11 from `plan.md`.

## Risks and safeguards

- jsdiff's line-splitting keeps `\r` — covered by the CRLF row so nobody "fixes" it silently later.
- A `content`/`new_content` pair also matches a payload that happens to carry both keys; that is a genuine before/after per the existing family inference, so it diffs — documented, not special-cased.
- The `success` tone is a compile-time break for both renderers' `BADGE_TONE` maps; step 5 adds the two entries in this phase so `type-check` never goes red between phases.

## Handoff to Phase 2

Phase 2 consumes `FileDiff` from `@/lib/tool-presentation`, `toHunkData` from `@/lib/git-hunk-adapter`, and the `success` tone. It must not import `diff` or `@/lib/diff-hunks`.
