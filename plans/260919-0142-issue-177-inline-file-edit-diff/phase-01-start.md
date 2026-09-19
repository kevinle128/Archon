---
phase: 1
title: 'Phase 1: Bounded differ, adapter move, presentation contract'
status: blocked
priority: P1
effort: '1.5d'
dependencies: [product-contract-gate]
---

# Phase 1: Bounded differ, adapter move, presentation contract

## Goal

After the plan's product-contract gate is resolved to presentation-only scope, add the pure bounded line-diff path, move the existing hunk adapter into `lib/`, and expose file-edit counts/facts/body data from `tool-presentation.ts`. This phase has no React rendering and changes no provider, transcript, API, or stored shape.

## Pre-edit checks

- Confirm the authoritative CAP-5/Story/test-plan wording has been reconciled and remove this phase's `blocked` status.
- Re-read `tool-presentation-contract.md`, its inline-diff section, and the corresponding `test-plan.md` bullets.
- Confirm the aliases in `BEFORE_AFTER_PAIRS`, the `file` body arm, `toolRowPresentation` body-bar composition, and both renderer tone maps have not changed.
- Confirm `git-hunk-adapter.ts` still has only the source-control component and its test as consumers and that generated `GitDiffHunk`/`GitDiffChange` types have the expected line-number fields.
- Confirm `node-message-pages.ts` still preserves existing row/payload object identity on ordinary merges. If it no longer does, retain correctness through the pair LRU and revise the WeakMap performance claim.

## Files

| Path                                                                                                                                        | Change                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/web/package.json`, `bun.lock`                                                                                                     | add exact `"diff": "9.0.0"`                                                |
| `packages/web/src/lib/diff-hunks.ts`, `packages/web/src/lib/diff-hunks.test.ts`                                                             | create bounded, memoized conversion                                        |
| `packages/web/src/lib/git-hunk-adapter.ts`, `packages/web/src/lib/git-hunk-adapter.test.ts`                                                 | move from `components/workflows/source-control` and use generated types    |
| `packages/web/src/components/workflows/source-control/virtualized-diff.tsx`                                                                 | update adapter import only                                                 |
| `packages/web/src/lib/tool-presentation.ts`, `packages/web/src/lib/tool-presentation.test.ts`                                               | qualify pairs, WeakMap results, badges, facts, file body result            |
| `packages/web/src/components/workflows/NodeRoom.tsx`, `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | add the exhaustive `success` badge-tone entry only                         |
| `_bmad-output/specs/spec-agent-node-room/SPEC.md`, `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`                         | record the product-gate resolution in CAP-5 and Story 1.4                  |
| `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`, `_bmad-output/specs/spec-agent-node-room/test-plan.md`             | document shipped invariants and exact tests, including the gate resolution |

## Pure differ contract

`diff-hunks.ts` is the only production module allowed to import/call `structuredPatch`.

```ts
import type { components } from '@/lib/api.generated';

type GitDiffHunk = components['schemas']['GitDiffHunk'];

export const MAX_DIFF_SIDE_BYTES = 65_536;
export const MAX_DIFF_SIDE_LINES = 2_000;
export const MAX_DIFF_EDIT_LENGTH = 2_000;
export const DIFF_CONTEXT_LINES = 4;
export const DIFF_MEMO_ENTRIES = 256;
export const DIFF_MEMO_SOURCE_CODE_UNITS = 1_048_576;

export interface DiffHunksResult {
  hunks: GitDiffHunk[];
  added: number;
  deleted: number;
}

export type DiffHunksFn = (before: string, after: string) => DiffHunksResult | null;

export function createDiffHunks(options?: {
  memoEntries?: number;
  memoSourceCodeUnits?: number;
  patch?: typeof import('diff').structuredPatch;
  byteLength?: (value: string) => number;
}): DiffHunksFn;

export const diffHunks: DiffHunksFn;
```

### Bounds and memo rules

1. If either `.length` exceeds `MAX_DIFF_SIDE_BYTES`, return `null` immediately. UTF-8 bytes cannot be fewer than UTF-16 code units, so this refusal is sound and intentionally uncached.
2. Otherwise create an unambiguous length-delimited pair key, check the LRU before any UTF-8 scan, and refresh a hit by delete/reinsert. Return the stored object identity.
3. On a miss, measure both sides with the injected `byteLength` or a shared production `TextEncoder`. If either is over the byte limit, cache `null`.
4. Count logical lines without `split`: `''` has zero; otherwise count newlines and add one only when the string lacks a trailing newline. Stop at limit + 1. Cache `null` when either side is over 2,000.
5. Call `structuredPatch('', '', before, after, '', '', { context: 4, maxEditLength: 2_000 })`. Four is the pinned v9 default; passing it explicitly prevents a dependency default from silently changing the UI. Do not pass `timeout`, `newlineIsToken`, or normalization options. Cache `null` for `undefined` or a throw.
6. Cache every computed result. Track each entry's `before.length + after.length`; after insertion, evict least-recently-used entries until both the entry count and total source-code-unit budget hold. The 1,048,576-unit default holds at most eight maximum-size pairs rather than allowing 256 such keys to retain roughly 64 MiB of UTF-16 text.
7. Factory options must be positive finite integers where applicable; fail fast on invalid test/production configuration.

### Hunk conversion and display safety

- Start counters from each jsdiff hunk's `oldStart` and `newStart`.
- A leading space emits `normal` and advances both; `-` emits `delete` and advances old; `+` emits `insert` and advances new.
- Skip any entry beginning with `\\` (the no-newline marker) without advancing either counter. It may occur mid-array and more than once.
- Preserve jsdiff's hunk order. Never alternate or sort changes to imitate the mockup.
- Set a deterministic header `@@ -oldStart,oldLines +newStart,newLines @@` for later-hunk decoration.
- Before putting line content in `GitDiffChange`, pass it through `sanitizeBounded(..., 1024)`, then escape every Unicode format-control code point (general category `Cf`) and U+2028/U+2029 into uppercase ASCII `\\u{HEX}` with a bounded code-point accumulator. Append an ellipsis inside the same 1,024-code-unit ceiling if either pass truncates.
- Diff the raw strings; sanitization affects display content only. Raw retains the original payload.

## Presentation contract

Add one local `fileEditPair(record)` based on the existing alias table:

- use the file's existing `hasOwn` helper for both keys before reading either value;
- require both values to be strings; `''` is valid;
- call it only after the family resolves to `file`;
- do not add provider-name branches or prose parsing.

Read the two values inside the helper's local `try`/`catch`; an accessor that throws is a non-qualifying pair, not a reason to reclassify the row or block the transcript.

Add a module-level `WeakMap<object, DiffHunksResult | null>` and a `fileDiffFor(record)` helper. The first summary/body request for an input record calls the shared `diffHunks`; later requests for the same object are identity lookups. Equal strings on a newly parsed object reuse the pair LRU.

Extend the presentation types:

- export `type FileDiff = DiffHunksResult` from `tool-presentation.ts` so renderers consume the presentation contract rather than importing the differ;
- `ToolRowBadgeKind`: add `diff`.
- `ToolRowBadgeTone`: add `success`.
- file body arm: add `diff: FileDiff | null`.

For a nonempty valid diff:

- append `+n` only when `added > 0`, with `kind: 'diff'`, `tone: 'success'`;
- append `−m` only when `deleted > 0`, with `kind: 'diff'`, `tone: 'danger'`;
- body facts are `N hunk`/`N hunks`, followed by `replace_all: true|false` only when that own input is boolean.

For a valid identical pair, add no diff badges and set the file fact to `no changes`. For no pair or any refusal, add no diff badges/facts and preserve today's file fallback. Compose body facts for all families, not only task, while preserving current outputs for families whose facts are empty. Exclude `diff` badges from the body bar.

Use `fileDiffFor` from both the summary and the file body arm. Do not call `diffHunks` directly from one path and bypass the row cache from the other. Add `success: { className: 'text-success' }` to both exhaustive renderer tone maps so Phase 1 type-checks; Phase 2 owns all other JSX.

## Tests first

### `diff-hunks.test.ts`

Use the factory rather than global reset hooks:

- identical ASCII sides at the exact byte limit are accepted; ASCII limit + 1 refuses before `patch`; a multibyte string under the code-unit precheck but over the UTF-8 limit invokes `byteLength` once per side and caches the refusal;
- exactly 2,000 logical lines accepted and 2,001 refused without `patch`, including the no-trailing-newline off-by-one case;
- a real disjoint 1,000-old/1,000-new fixture is accepted at edit length 2,000; 1,001-old/1,000-new refuses at 2,001 while both sides remain under the line/byte caps; an injected `undefined` result also refuses;
- thrown patch errors return and cache `null`;
- empty-to-content, deletion-to-empty, identical sides, repeated content, and CRLF-vs-LF produce deterministic results;
- one mid-array and two no-newline markers do not advance counters; every emitted line number is positive and `toHunkData` accepts every result;
- ANSI, C0/C1, bidi overrides/isolates, zero-width format controls, BOM, and U+2028/U+2029 cannot create hidden/reordered/fake display lines; escapes and ellipsis stay within 1,024 code units;
- same pair returns the identical result and calls `patch` once; a hit refreshes LRU order; count eviction and source-weight eviction both recompute only the evicted pair.

### Adapter regression

Move the adapter test with the file. Keep all conversion assertions. Run the existing source-control tests after updating `virtualized-diff.tsx`.

### `tool-presentation.test.ts`

- canonical pair and both aliases qualify only for the `file` family; empty sides qualify; inherited/prototype keys, throwing accessors, one side, wrong types, no input, and aliased non-file families do not;
- summary produces exact badges/facts and body bar `file · 1 hunk · replace_all: false`; singular/plural and insert-only/delete-only cases are correct;
- identical pair yields `no changes`; refused/throwing pair uses the unchanged preview fallback;
- repeated summary/body calls for the same record invoke the differ once; a second record with equal strings receives the same pair-cache object;
- current non-file body bars are unchanged; existing strict file-body expectations add `diff: null`;
- family inference, name, preview, unreadable state, and Raw payload are unchanged.

## Documentation update

Update only CAP-5, Story 1.4, and the owning inline-diff/test sections. Record behavior and limits, not phase numbers, audit labels, or plan finding IDs. The docs must explicitly state the product-gate resolution, pair qualification, deterministic caps, dual-bounded memoization, snippet-relative numbering, no-newline handling, visible control escaping, identical/refusal semantics, failed-output behavior, and later-hunk separator rule. Do not edit `sources/spec-readable-agent-transcript/`: its header marks it superseded and retained only for audit.

## Implementation order

1. Resolve and record the product gate.
2. Add the exact dependency and lockfile update.
3. Move the adapter/test and fix imports; run its focused regressions.
4. Write differ tests red, then implement the pure differ.
5. Write presentation tests red, then implement the pair/WeakMap/badges/facts/body changes.
6. Add the exhaustive tone-map entries.
7. Update the four owning contract/story sections.
8. Run focused tests, then web type-check/lint/format.

## Commands

```bash
cd packages/web && bun test src/lib/diff-hunks.test.ts src/lib/git-hunk-adapter.test.ts src/lib/tool-presentation.test.ts
cd packages/web && NODE_ENV=development bun test src/components/workflows/source-control/
bun run type-check
bun run lint
bun run format:check
```

## Exit criteria

- [ ] The gate is resolved and docs no longer overclaim Codex.
- [ ] `@archon/web` directly pins `diff@9.0.0`; one production module calls `structuredPatch`.
- [ ] All bound, conversion, safety, cache-count, cache-weight, and adapter tests pass.
- [ ] The moved adapter uses generated types and all old consumers/tests use its new path.
- [ ] Presentation qualification, badges, facts, fallback, no-changes, WeakMap, and pair-cache contracts pass without changing non-file output.
- [ ] Both tone maps are exhaustive and focused type-check/lint/format are green.
- [ ] Owning docs describe actual behavior and the resolved scope.

## Risks and safeguards

- CRLF is part of the raw comparison, so an LF/CRLF rewrite may show changed rows whose sanitized visible text is otherwise equal; markers still honestly show the raw change. Cover it and document it.
- The cache key retains source text by design; the source-weight budget is therefore mandatory, not optional optimization.
- Do not expose test-only cache clearing or patch seams on the default singleton. Tests create isolated factories.

## Handoff to Phase 2

Phase 2 consumes `FileDiff` from `@/lib/tool-presentation`, `toHunkData` from `@/lib/git-hunk-adapter`, and the new success tone. It must not import `diff` or `@/lib/diff-hunks`.
