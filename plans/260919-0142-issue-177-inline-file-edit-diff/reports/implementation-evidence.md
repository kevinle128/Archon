# Implementation Evidence — Issue #177 / Story 1.4 (CAP-5, UX-DR3)

Inline file-edit diff for persisted two-sided `file` tool rows on Legacy
`NodeRoom` and Console `ConsoleAgentHistoryList`.

## Resolved product gate

The CAP-5 contract was resolved to **presentation-only scope** (commit
`79e3f92c`, US-001): the diff renders when a persisted `file`-family tool row
carries both `before` and `after` strings; every other row keeps the path-plus
-preview fallback and a diff is never fabricated. Current Codex `file_change`
events are emitted as `system` chunks (`codex/provider.ts:709`) that the
executor debug-logs (`dag.system_message_unhandled`) rather than persisting,
so they never become file rows — Codex transcript visibility is separately
tracked work. The bare no-input e2e row is labeled **generic no-input
fallback** everywhere; it is not Codex evidence.

## What shipped

| Story  | Commit                   | Content                                                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-001 | `79e3f92c`               | CAP-5 / Story 1.4 / contract docs rewritten presentation-only; Codex overclaims corrected in EXPERIENCE.md                                                                                                                                                                                                                    |
| US-002 | `4af2cce9`               | `diff@9.0.0` exact dep; `diff-hunks.ts` sole `structuredPatch` caller (65,536-byte / 2,000-line side caps, `context: 4`, `maxEditLength: 2000`, dual-bounded LRU); `git-hunk-adapter.ts` moved to `src/lib/`; `tool-presentation.ts` pair qualification, `WeakMap` cache, `+n`/`−m` badges, `N hunk(s)` + `replace_all` facts |
| US-003 | `62148db2`               | `InlineDiff` on both renderers (react-diff-view v3.3.3 unified, one visible gutter with 1ch marker + 3ch snippet-relative number, `Decoration` only before later hunks); scoped `.tool-diff` CSS block; boundary + anatomy + Raw-swap tests                                                                                   |
| US-004 | `69ed4eae` + this commit | e2e-fake `fileEdit` scenario (edit/failed/write/bare), pinned constants + tests; `e2e-file-edit.yaml` fixture + `runFileEditWorkflow()`; `file-edit-diff.spec.ts` full-stack proof; scoped delete-foreground contrast fix; this evidence                                                                                      |

## Validation — executed in the PRD order

| Gate           | Command                                                                     | Result                                                |
| -------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| providers      | `bun --filter @archon/providers test`                                       | green (all legs incl. 37 e2e-fake tests, 234 expects) |
| web lib        | `cd packages/web && bun test src/lib/`                                      | 880 pass / 0 fail                                     |
| web components | `cd packages/web && NODE_ENV=development bun test src/components/`          | 539 pass / 0 fail                                     |
| web console    | `cd packages/web && NODE_ENV=development bun test src/experiments/console/` | 1002 pass / 0 fail                                    |
| web full       | `bun --filter @archon/web test`                                             | green (880 + 51 + 18 + 539 + 53 + 1002)               |
| e2e typecheck  | `bun run --cwd e2e typecheck`                                               | clean                                                 |
| file-edit spec | `bun run --cwd e2e test:ui -- --grep 'file-edit'`                           | 5/5 pass                                              |
| HITL suite     | `bun run --cwd e2e test:ui:hitl`                                            | green (see unblock notes)                             |
| full validate  | `bun run validate`                                                          | green                                                 |

Root `bun test` was never run; no second dev server was started (the e2e
harness owns its Archon runtime on `ARCHON_E2E_PORT_BASE`).

## Browser proof — `e2e/ui/file-edit-diff.spec.ts` (5 tests, both surfaces)

- **Qualified edit**: collapsed `+2` / `−2` (U+2212) badges on a one-line
  summary; open body bar `file · 1 hunk · replace_all: false`; path first, then
  one `.tool-diff` with jsdiff-ordered cells (context, 2 delete, 2 insert,
  context), markers `['', '−', '−', '+', '+', '']`, numbers `1,2,3,2,3,4`;
  single hunk → zero `tbody.diff-decoration`; success prose absent from the
  normalized body; Raw removes the table, shows `old_string`/`new_string`, and
  closing Raw restores the identical diff.
- **Failed edit**: mounts open, identical diff plus the normalized failure
  output `String to replace not found in file.` in a second inset box.
- **Write row**: path + preview, no fabricated badge/table.
- **Bare row** (`edit`, no stored input): chip/path `edit` + preview —
  the generic no-input fallback, no diff.
- **Network quietness**: a request ledger attached around every open/toggle
  records zero requests outside the app origin (page navigations legitimately
  fetch the app's declared webfonts and are out of scope for the interaction
  window).
- **Geometry**: at 1440×1000 the room is sized through the production ratio
  path to Legacy 460px / Console 520px, then forced shared 460px, then the
  390×844 responsive viewport — table width matches box content within 2px,
  `pre-wrap` + `overflow-wrap: anywhere`, no horizontal overflow, one-line
  summaries throughout.
- **Accessibility**: native details/summary, zero focusable descendants inside
  the diff, Tab order summary → Raw → the existing next control.
- **Contrast**: every required pair measured ≥ 4.5:1 on both surfaces'
  themes — see `visual-acceptance.md` and
  `captures/file-edit-measurements.json`. The delete foreground is
  `--tool-diff-delete-fg: color-mix(in oklch, var(--error) 85%, var(--text-primary))`
  (pure `--error` measured 4.32 on Legacy; the floor was never lowered and the
  marker hue stays on the error axis).

## Recorded deviations (planned, explained)

1. **Snippet-relative line numbers** — the hunk's own old/new counters, per
   the diff contract, not whole-file line numbers.
2. **Grouped jsdiff ordering** — deletes then inserts within a change block,
   not interleaved source order.
3. **Theme axis = the two token sources** — the app ships dark-only
   (`index.css:9`, EXPERIENCE.md:38); each surface resolves its own token file
   (`index.css` for Legacy, `experiments/console/theme.css` for Console), so
   the surface × theme matrix is covered by measuring each surface under its
   own theme.

## Unblock ledger (separate commits, zero story changes)

- `9992e724` — `chore(unblock)`: pre-existing OMP `session-usage` test
  exceeded its 20s timeout under full-suite load (same fingerprint on clean
  base); timeouts raised to 60s/20s. Providers gate then green.
- `a04d8db9` — `chore(unblock)`: three stale HITL contracts left by merged
  PR #202 — restored `focus-visible:` label/border classes #199 shipped on
  the closed Raw toggle (both renderers); gallery Raw-swap probe now targets
  the raw panel's real selector (`:scope > div > pre`); `workflow-run-hitl`
  collapsed rows aligned to the documented lazy-mount contract
  (`button[aria-expanded]` count 0, matching the sibling spec); the
  `history-complete` tail assertion updated for the family-body contract
  (the fetched output legitimately renders in the normalized body). All
  previously-failing tests re-run green; full `test:ui:hitl` green.

## Links

- Spec: `e2e/ui/file-edit-diff.spec.ts`
- Fixture: `e2e/fixtures/workflows/e2e-file-edit.yaml`
- Provider: `packages/providers/src/e2e-fake/provider.ts` (`fileEdit`)
- Visual matrix + measurements: `reports/visual-acceptance.md`,
  `reports/captures/`
