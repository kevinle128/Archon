# Review — Version Reality Check

**Target:** `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`
**Lens:** every committed decision must be web-researched or reality-checked, not asserted from training data.
**Date:** 2026-09-12
**Method:** npm registry metadata, downloaded package tarballs (`.d.ts` read directly), executed `structuredPatch` under `bun`, executed ESLint 9.39.4 against probe files, and `grep`/`sed` over the repo.

**Verdict:** the Stack table's "verified 2026-09-12" mostly holds — every version claim is correct and every `file:line` citation is exact. Two prose claims used as load-bearing justification are wrong: AD-4 asserts a library behaviour that does not exist by default (HIGH), and AD-5 asserts a missing ESLint option that has existed since v9.37.0 (MEDIUM).

---

## Finding 1 — AD-4: `structuredPatch` does NOT return `undefined` by default. Severity: HIGH.

**The claim (spine line 90):**

> `structuredPatch` returns `undefined` past its timeout or edit-length bound — that path degrades to path-plus-preview, the same fallback Codex already takes, per AD-3.

**What is actually true.** `diff` has no built-in timeout and no built-in edit-length bound. Both are caller-supplied and neither has a default:

```ts
// diff@9.0.0 libesm/types.d.ts
export interface TimeoutOption {
  timeout: number;
} // required member
export interface MaxEditLengthOption {
  maxEditLength: number;
} // required member
export type AbortableDiffOptions = TimeoutOption | MaxEditLengthOption;
```

The nullable return exists on one overload only — the one you reach by passing those options:

```ts
// diff@9.0.0 libesm/patch/create.d.ts
export declare function structuredPatch(..., options: StructuredPatchOptionsAbortable): StructuredPatch | undefined;
export declare function structuredPatch(..., options?: StructuredPatchOptionsNonabortable): StructuredPatch;   // non-nullable
```

Verified empirically against the real 9.0.0 build: a plain call returned a `StructuredPatch`; only `{ maxEditLength: 0 }` returned `undefined`.

**Why this matters, in three steps.**

1. **The fallback does not exist unless the spine names a bound.** AD-4's degrade-to-path-plus-preview arm, and AD-3's total-function guarantee that leans on it, both require the implementer to pass `{ maxEditLength: N }` or `{ timeout: N ms }`. The spine names neither value.
2. **Without a bound the guard is dead code that ships silently.** TypeScript types the non-abortable overload as non-nullable, so `if (!patch)` is unreachable. `@typescript-eslint/no-unnecessary-condition` is `'off'` for `packages/*/src/**` (`eslint.config.mjs:96`), so lint will not flag it. The unreachable branch reaches `main` looking like a working safety net.
3. **A hang is not a throw, so AD-3 does not cover it.** An unbounded synchronous Myers diff on the render thread for a whole-file Edit payload freezes the tab; it never throws, so "no function in the core throws" is satisfied while the UI is unusable. AD-7's scale argument ("forty rows") bounds _row count_, not _payload size_ — a single Edit row can carry a megabyte.

**Report, not a fix:** AD-4 should state the bound as an explicit design value and say the return is nullable _only_ under that overload.

**Also unverified in the same sentence:** "the same fallback Codex already takes." Out of this lens; not checked. Flagging it as an uncited cross-reference.

---

## Finding 2 — AD-5: the base `no-restricted-imports` rule DOES have `allowTypeImports`. Severity: MEDIUM (false premise; the rule it justifies survives).

**The claim (spine line 95):**

> …because the lint rule bans the `@/lib/api` path outright and the base `no-restricted-imports` rule has no type-import exemption.

**What is actually true.** `allowTypeImports` was added to the **base** ESLint rule in **v9.37.0** ("aligns the rule with the corresponding typescript-eslint rule"). The repo declares `eslint: ^9.39.1` and `bun.lock` resolves **9.39.4** — the option is available today.

Verified by running the repo's exact ESLint version against a probe:

| Config on pattern `['@/lib/api']`            | `import type { GitDiffHunk } from '@/lib/api'`              | exit |
| -------------------------------------------- | ----------------------------------------------------------- | ---- |
| `allowTypeImports: true`                     | accepted, no schema error                                   | 0    |
| option omitted (**the repo's config today**) | `error … import is restricted from being used by a pattern` | 1    |

**What survives and what does not.**

- **Survives:** AD-5's operative rule. As `eslint.config.mjs:126-163` stands today, the base rule genuinely does flag a type-only import from `@/lib/api`, so a moved adapter importing from `@/lib/api` would be unusable from Console. Re-aliasing from `api.generated` is a correct instruction.
- **Wrong:** the reason. The exemption is not absent from the tool; the repo's config simply does not set it. That is a **choice**, and the spine should reject the option with a reason rather than assert it doesn't exist. A builder or reviewer reading AD-5 would conclude no alternative exists, which is false.

**Two reasons this is more than a wording nit.**

- The config's own comment (`eslint.config.mjs:121-122`) states the intent as "no _runtime_ `@/lib/api`. Type-only `@/lib/api.generated` is allowed." Setting `allowTypeImports: true` on the `@/lib/api` pattern matches that stated intent exactly and would make the adapter move zero-diff on imports.
- AD-2 says the boundary "is expressed by adding a pattern to that rule, never by prose in a document." Editing the rule to admit type-only imports is squarely inside the spine's own stated philosophy, so the option deserves an argued rejection.

---

## Finding 3 — AD-4's `\ No newline at end of file` handling is under-specified. Severity: MEDIUM.

**The claim (spine line 90):** the mapper "walks `lines` with running counters, drops the `\ No newline at end of file` marker."

Singular, and implicitly trailing. Verified against real 9.0.0 output — it is neither. When both sides lack a trailing newline and their last lines differ, the marker is emitted **twice in one hunk, and the first is mid-array**:

```
oldLines: 3, newLines: 3        // counts EXCLUDE the markers
lines: [
  " one",
  " two",
  "-END-A",
  "\\ No newline at end of file",   // index 3 of 6 — not trailing
  "+END-B",
  "\\ No newline at end of file"
]
```

A mapper that drops only a trailing marker miscounts by one and emits wrong line numbers for every change after it — which under AD-4's own stated risk is "wrong diffs a reader believes." The counter walk must skip the marker wherever it appears, any number of times.

---

## Verified correct

Every one of these was checked against a primary source, not asserted.

**`diff` (jsdiff) 9.0.0 — all four sub-claims hold.**

| Sub-claim                                                                                           | Result                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 9.0.0 is current latest on npm                                                                      | ✅ `dist-tags.latest = 9.0.0`, published 2026-04-13                                                                                                                                                    |
| ships its own types, `@types/diff` unneeded                                                         | ✅ `exports` maps both conditions to `libesm/index.d.ts` / `libcjs/index.d.ts`; `@types/diff` is a **deprecated stub** — _"diff provides its own type definitions, so you do not need this installed"_ |
| 9.x still exports `structuredPatch`                                                                 | ✅ present in `libesm/patch/create.d.ts`                                                                                                                                                               |
| `StructuredPatchHunk` = `{oldStart, oldLines, newStart, newLines, lines: string[]}`, prefix-encoded | ✅ **byte-exact** match to the interface; run output confirms `' '` / `'-'` / `'+'` prefixes                                                                                                           |
| ESM-only? does it matter for Vite?                                                                  | ✅ **dual**, not ESM-only (`exports` has both `import` and `require`). No concern for Vite 6 either way                                                                                                |

**8.x → 9.0.0 breaking changes affecting this usage: none.** From the project's own `release-notes.md`, 9.0.0 drops ES5 support (irrelevant to a Vite 6 React 19 app), reworks `parsePatch`/`formatPatch` for Git-style patches (unused here), and widens `StructuredPatch.oldFileName`/`newFileName` to `string | undefined` (irrelevant to the hunk mapper; would matter only to a later adopter reading filenames). `StructuredPatchHunk` and the `structuredPatch` overload set are **identical** between 8.0.4 and 9.0.0 — diffed both `.d.ts` files directly.

**The three "already declared" dependencies — all three confirmed in `packages/web/package.json`:**

| Package            | Spine says                    | package.json          | bun.lock | npm latest             |
| ------------------ | ----------------------------- | --------------------- | -------- | ---------------------- |
| `react-diff-view`  | `3.3.3 — already declared`    | `"3.3.3"` (exact pin) | 3.3.3    | **3.3.3** ✅ is latest |
| `highlight.js`     | `^11.11.1 — already declared` | `"^11.11.1"`          | 11.11.1  | 11.12.0 (INFO only)    |
| `rehype-highlight` | `^7.0.0 — already declared`   | `"^7.0.0"`            | 7.0.2    | **7.0.2** ✅           |

**`react-diff-view` 3.3.3 shape still matches the adapter.** `HunkData` and `ChangeData` are re-exports of `gitdiff-parser`'s `Hunk` and `Change` (`types/utils/parse.d.ts`: `export type { File as FileData, Hunk as HunkData, Change as ChangeData }`). `gitdiff-parser@0.3.1` defines `Hunk {content, oldStart, newStart, oldLines, newLines, changes}` and the three-arm `Change` union with `isInsert`/`isDelete`/`isNormal` discriminant flags. `git-hunk-adapter.ts`'s `toHunkData`/`toChangeData` produce exactly those shapes, field for field. No drift.

**bun.lock — no duplicate-version or bundling concern.** Root `diff` resolves to **8.0.3**, pinned by `astro` (`^8.0.3`) and `shadcn` (`^8.0.2`), both build-time deps of other packages. The lock already nests package-local copies where a dependent needs a different range — `9.0.0` under both `@deepseek-ai/*` packages, `8.0.4` under `@earendil-works/pi-coding-agent`. Adding `^9.0.0` to `@archon/web` produces the same nesting. Vite resolves from `packages/web`, so the browser bundle sees exactly one copy; the 8.0.3 root copy never enters it (astro belongs to `docs-web`, shadcn is a devDependency CLI).

**Measured bundle cost for AD-8.** AD-8 says "the only operational delta is bundle size: one dependency, `diff`" without a number. Tree-shaken `structuredPatch` alone, bundled for browser with `--minify`: **~10.0 KB minified / ~3.8 KB gzipped**. (The 615 KB `unpackedSize` on npm counts both CJS and ESM builds plus sourcemaps and is not the shipped cost.) The claim is reasonable; it should carry the number.

**Every repo citation is exact.**

| Cited as                                                                                   | Reality                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `eslint.config.mjs:126-163`                                                                | ✅ the console-isolation block, lines 126–163 of a 164-line file                                                                                                               |
| `api.ts:472-473`                                                                           | ✅ `GitDiffHunk` at 472, `GitDiffChange` at 473 — plain `components['schemas'][…]` aliases, so the re-alias really is mechanical                                               |
| `App.tsx:23-64`                                                                            | ✅ the `ErrorBoundary` class, exactly                                                                                                                                          |
| `App.tsx:93-95`                                                                            | ✅ the "Classic UI … Removed from the codebase once the console has proven itself" comment                                                                                     |
| `ConsoleNodeRoom.tsx:607`, `ConsoleExecutionHistory.tsx:204`, `NodeTranscriptPane.tsx:236` | ✅ all three `buildAgentHistory` call sites, exactly                                                                                                                           |
| "its two existing consumers — `virtualized-diff.tsx` and its test"                         | ✅ exactly two: `virtualized-diff.tsx:9` and `git-hunk-adapter.test.ts:6`                                                                                                      |
| "Console imports nothing from `@/lib/api` today"                                           | ✅ grep over `experiments/console/` returns nothing                                                                                                                            |
| AD-2's correction to the parent's "one sanctioned exception" wording                       | ✅ consistent with the config comment at `eslint.config.mjs:122-123`, which names `@/lib/run-graph` as "outside these restricted patterns" rather than as an encoded exception |

---

## Unresolved questions

1. **AD-4's bound.** What `maxEditLength` (or `timeout` ms) should the spine commit to? Until a value is named, the degrade path and AD-3's coverage of the diff arm are both unbacked.
2. **AD-5's disposition.** Does the lead want AD-5 to _adopt_ `allowTypeImports: true` on the `@/lib/api` pattern (matching the config's own stated "no runtime `@/lib/api`" intent and removing the need to re-alias), or to _reject_ it with a stated reason and keep the `api.generated` re-alias? Either is defensible; the current text does neither, because it assumes the option doesn't exist.
3. **Out of lens, uncited:** AD-4's "the same fallback Codex already takes" was not verified.
