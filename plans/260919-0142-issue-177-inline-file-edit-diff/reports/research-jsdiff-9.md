# Research: jsdiff (`diff`) 9.0.0 — `structuredPatch` facts the plan relies on

Sources: npm registry metadata for `diff@9.0.0` (published 2026-04-13, `latest`), and the GitHub source at the release commit `db0b12ace208da7fd741cf96d97f009347a9eaa8` (`src/patch/create.ts`, `src/diff/base.ts`, `src/types.ts`, `release-notes.md`).

## Signature and return shape

- Non-abortable overload: `structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader?, newHeader?, options?) => StructuredPatch`.
- Abortable overload (any of `timeout` / `maxEditLength` set): returns `StructuredPatch | undefined`. `diffLinesResultToPatch(diff)` begins with `if (!diff) return;` and `diffLines` returns `undefined` when the edit-length loop exhausts `maxEditLength` without a solution.
- `StructuredPatchHunk = { oldStart, oldLines, newStart, newLines, lines: string[] }`, lines prefix-encoded (` `, `-`, `+`, `\`).

## Options

- `context` — default 4 (`if (typeof optionsObj.context === 'undefined') optionsObj.context = 4`).
- `maxEditLength` — no default (unset means `oldLen + newLen`, i.e. unlimited).
- `timeout` — no default (`options.timeout ?? Infinity`). No `AbortSignal` support exists.
- `newlineIsToken` — throws for patch-generation functions.
- `ignoreWhitespace`, `stripTrailingCr` — accepted, default `false`.

## The `\ No newline at end of file` marker

Step 2 of `create.ts`:

```ts
for (const hunk of hunks) {
  for (let i = 0; i < hunk.lines.length; i++) {
    if (hunk.lines[i].endsWith('\n')) hunk.lines[i] = hunk.lines[i].slice(0, -1);
    else { hunk.lines.splice(i + 1, 0, '\\ No newline at end of file'); i++; }
  }
}
```

- It is its own array entry, spliced immediately after whichever line lacked a trailing newline, so it can sit between a `-` line and a `+` line (mid-array) and appear twice in one hunk (once after the deleted last line, once after the inserted last line).
- `oldLines`/`newLines` are computed in Step 1, before the splice, so the marker is never counted.
- Every other line entry has its trailing `\n` stripped; a CRLF input keeps its `\r` at the end of the line content (`linedelimiters` was removed in 6.0.0).

## Degenerate inputs

- Identical strings → `hunks: []` (an empty array, not `undefined`).
- Empty old or new string → one hunk with `oldLines` or `newLines` of `0`.

## Packaging

- Ships its own TypeScript types (`StructuredPatch`, `StructuredPatchHunk` exported from `src/types.ts`); `@types/diff` is not needed.
- `"type": "module"`, `main` → `libcjs/index.js`, `module` → `libesm/index.js`, `exports` map with `import`/`require` conditions. Zero runtime dependencies.

## Breaking changes reaching 9.0.0 that matter here

- 6.0.0: `linedelimiters` removed; `maxEditLength: 0` means zero; `structuredPatch` returns `undefined` (not throw) when `maxEditLength` is exceeded; `newlineIsToken` rejected for patch functions.
- 8.0.0: TypeScript rewrite with bundled types; `Diff` is a class; `merge` removed.
- 9.0.0: ES5 dropped; `formatPatch` fixes; git-style patch fields on `StructuredPatch`; `oldFileName`/`newFileName` typed `string | undefined`.

Status: DONE — all claims read from the pinned source; not executed locally.
