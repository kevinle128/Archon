# Research: react-diff-view 3.3.3 — unified view facts the plan relies on

Sources: the `react-diff-view@3.3.3` npm tarball (identical to the GitHub `v3.3.3` tag), README, `src/Diff/index.tsx`, `src/Hunk/UnifiedHunk/UnifiedChange.tsx`, `src/Hunk/utils.tsx`, `src/context/index.ts`, `style/index.css`.

## Unified-view DOM

- Each change is `<tr class="diff-line …">` containing, in order: a gutter `<td>` for `side: 'old'`, a gutter `<td>` for `side: 'new'`, then one `<td class="diff-code diff-code-{normal|insert|delete}">`.
- Both gutter cells carry the same classes: `diff-gutter diff-gutter-{normal|insert|delete}` (plus `diff-gutter-selected`). There is **no** `diff-gutter-old` / `diff-gutter-new` class; the second cell must be targeted positionally (`:nth-child(2)`).
- The `<colgroup>` in unified mode is `<col class="diff-gutter-col"/><col class="diff-gutter-col"/><col/>` — two gutter columns.
- `diff-line-old-only` / `diff-line-new-only` exist only in split view.

## `renderGutter`

- `RenderGutter = (options: { change: ChangeData; side: Side; inHoverState: boolean; renderDefault: () => ReactNode; wrapInAnchor: (element: ReactNode) => ReactNode }) => ReactNode`.
- Called once per gutter cell, so in unified mode once with `side: 'old'` then once with `side: 'new'` for every row.
- `renderDefault()` returns the side's line number (`computeOldLineNumber` / `computeNewLineNumber`) or `undefined` when that side does not apply (insert has no old number, delete has no new number).
- `gutterType?: 'default' | 'none' | 'anchor'`; `'none'` removes both gutter `<col>`s and `<td>`s entirely; `'anchor'` wraps gutter content in an `<a href="#…">`.

## Children and hunk headers

- `children` is optional; the default renders `hunks.map(hunk => <Hunk key hunk={hunk} />)` (README: "The children is optional if you only need all hunks to be displayed").
- `hunk.content` (the `@@ -a,b +c,d @@` header) is never rendered by `Diff`/`Hunk`; a header row is produced only by placing a `<Decoration>` element before the `<Hunk>` inside an explicit `children` function.

## Styling

- `style/index.css` declares all theme values as `--diff-*` custom properties on `:root`: `--diff-background-color`, `--diff-text-color`, `--diff-font-family`, `--diff-selection-background-color`, `--diff-selection-text-color`, `--diff-gutter-{insert,delete,selected}-{background,text}-color`, `--diff-code-{insert,delete,selected}-{background,text}-color`, `--diff-code-{insert,delete}-edit-{background,text}-color`, `--diff-omit-gutter-line-color`.
- `.diff { border-collapse: collapse; table-layout: fixed; width: 100%; }`; `.diff-line { font-family: var(--diff-font-family); line-height: 1.5; }`; `.diff-code { word-wrap: break-word; padding: 0 0 0 .5em; white-space: pre-wrap; word-break: break-all; }` — code cells wrap by default.

## Other props

- `tokens`, `renderToken`, `optimizeSelection` are optional; without `tokens`, `CodeCell` renders the raw change content.

## Packaging

- No `exports` map: `main` → `cjs/index.js`, `module` → `es/index.js`, `types` → `types/index.d.ts`; the unbundled `esm/**` tree and `style/index.css` resolve by plain path, which is why the existing consumer imports the runtime `Diff` from `react-diff-view/esm/index.js` (README: "you can import from `react-diff-view/esm` to reference an unminified ESM module") and types from the bare specifier.

Status: DONE — read from the pinned tarball and README; not executed locally.

## Decoration and Hunk DOM (follow-up)

- `Decoration` renders `<tbody class="diff-decoration"><tr>…</tr></tbody>`. One child → a single `<td class="diff-decoration-content" colSpan={hideGutter ? 1 : 3}>`; two children → `<td colSpan={2} class="diff-decoration-gutter">` plus `<td class="diff-decoration-content">`. No anchors, `tabIndex`, or roles are added; content renders verbatim.
- `Hunk` delegates to `UnifiedHunk`/`SplitHunk`, both rendering `<tbody class="diff-hunk">` as a sibling of decoration bodies inside the same `<table>`.
