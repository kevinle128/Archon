---
title: 'Issue 177 inline file-edit diff'
description: 'Verified TDD plan for Story 1.4: render a file edit that carries both sides as a bounded, deterministic inline line diff through react-diff-view on Legacy and Console, never fabricating a diff from one side.'
status: pending
priority: P1
effort: '3 phases (~3.5d)'
issue: 'https://github.com/kevinle128/Archon/issues/177'
branch: archon/thread-5da49924
tags: [issue-177, agent-node-room, epic-1, web, frontend, feature, tdd]
blockedBy: []
blocks: []
created: 2026-09-19
baseline: 81ba296f
---

# Issue 177 inline file-edit diff

## Goal and user outcome

When an operator expands a `file`-family tool row whose payload carries **both** the before and after content (Claude `Edit`: `old_string` + `new_string`; also `old_str`/`new_str` and `content`/`new_content`), the body shows the change as an inline unified line diff rendered through `react-diff-view`: context, deleted, and inserted lines, each with a `+`/`−` marker and a line number. The collapsed row carries `+n −m` badges and the body bar reads `file · 1 hunk · replace_all: false`. A file row with only one side (a `Write` with `content`, a Codex-style row with no input at all) keeps today's path-plus-preview body and shows no diff badge. Pathological or oversized content is refused by the differ and falls back to path plus preview instead of blocking the UI.

This is Story 1.4 / FR5 / CAP-5 / UX-DR3 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`. It is a presentation change in `@archon/web` plus one deterministic e2e fixture in the fake provider. It changes no stored rows, API routes, schemas, generated types, real providers, or the workflow engine.

## Authority and verified evidence

- Story and capability: `epics.md` Story 1.4; `_bmad-output/specs/spec-agent-node-room/SPEC.md` CAP-5; `tool-presentation-contract.md` "Expanded body" table (`file` row) and "Inline diff" section; `test-plan.md` `diff-hunks.test.ts` and "Boundary checks".
- Design: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` (Badges row, Body bar row, "Body box: diff" row, Flow 2 climax and failure line), `DESIGN.md` (lines ~584 badge tones, ~588 body bar, ~593 diff column), `mockups/key-transcript-states.html` §D "file — inline diff", `review-accessibility.md` (line-number tone finding, `−m`/`+n` sign rule).
- Current code (re-derived, not assumed):
  - `packages/web/src/lib/tool-presentation.ts` (1,216 lines): the four-tier family resolver, `BEFORE_AFTER_PAIRS` at line ~143, the lazy `toolBodyPresentation()` and its `file` arm (`{ kind: 'file', path, preview, unreadable }`), `toolRowPresentation()` composing `bodyBarText` from `content.bodyFacts` (gated on the task body today) and the badge list (`ToolRowBadgeKind`, `ToolRowBadgeTone` without a `success` tone).
  - `packages/web/src/components/workflows/source-control/git-hunk-adapter.ts` (57 lines) converts a server-computed `GitDiffHunk` to react-diff-view `HunkData`; `requiredLine()` throws on a non-positive line number; types come from `@/lib/api`. Consumers: `virtualized-diff.tsx` and `git-hunk-adapter.test.ts`.
  - `virtualized-diff.tsx` imports the runtime `Diff` from `react-diff-view/esm/index.js`, types from `react-diff-view`, and the side-effect `react-diff-view/style/index.css`; `file-viewer.test.tsx` proves `Diff` renders under `bun test` with `renderToStaticMarkup`.
  - Both renderers (`packages/web/src/components/workflows/NodeRoom.tsx`, `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`) mount `ToolBodySwitch` only while a row is open with Raw closed, key `useMemo` on the input fields, and render the `file` arm as path then preview in `TOOL_BODY_BOX`. Each has its own `BADGE_TONE: Record<ToolRowBadgeTone, …>` map, so a new tone is a compile error until both maps carry it.
  - Console isolation: `eslint.config.mjs` bans `@/components/**` and runtime `@/lib/api` in `experiments/console/**`; `console-isolation.test.ts` additionally keeps an explicit allowlist of `@/lib/*` modules for the room files. Third-party imports (including CSS side effects) are outside both guards. `index.css` is loaded by `main.tsx` for the whole app, Console included (`App.tsx` mounts `ConsoleApp`).
  - `@archon/web` declares `react-diff-view: 3.3.3` and does **not** declare `diff`; the lockfile hoists an unrelated transitive `diff@8.0.3`, so an undeclared import would silently bind to the wrong major.
  - `packages/providers/src/e2e-fake/provider.ts` emits scenario-driven deterministic tool calls (`emitTool`, `emitTodo`, `taskDispatch`); `toolInput` is optional on the provider event type, so a no-input row is expressible. Fixture workflows live in `e2e/fixtures/workflows/` and are registered in `e2e/lib/playwright/archon-runtime.ts`; Playwright specs in `e2e/ui/` pin mirrored constants.
  - Codex serializes `file_change` items as a `system` message, never as a tool row (`packages/providers/src/codex/provider.ts` ~line 709). The "Codex edit without input" acceptance case is therefore exercised as a `file`-family row with missing or one-sided input, not by changing Codex.
- Library facts verified from pinned sources (see `reports/research-jsdiff-9.md` and `reports/research-react-diff-view-3.3.3.md`):
  - jsdiff `9.0.0`: `structuredPatch(oldName, newName, oldStr, newStr, oldHeader?, newHeader?, options)`; with `maxEditLength` set it returns `StructuredPatch | undefined` (`undefined` when the bound is exceeded); `context` defaults to 4; no default `maxEditLength` or `timeout`; `newlineIsToken` throws for patch functions. Each `hunk.lines` entry is prefix-encoded with its trailing `\n` stripped, and `'\\ No newline at end of file'` is **spliced in as its own entry immediately after any line that lacked a newline** — so it can sit between a `-` and a `+` line and appear twice in one hunk — and it is not counted in `oldLines`/`newLines`. Identical inputs yield `hunks: []`. Ships its own types; zero dependencies; ESM + CJS via `exports`.
  - react-diff-view `3.3.3`: `viewType="unified"` renders per change one `<tr class="diff-line">` with **two** gutter `<td class="diff-gutter diff-gutter-{normal|insert|delete}">` cells (old then new, no old/new class) and one `<td class="diff-code diff-code-{type}">`; `renderGutter({ change, side, inHoverState, renderDefault, wrapInAnchor })` is called once per gutter cell; `renderDefault()` returns the side's line number or `undefined`. `Diff` without children renders every hunk; the `@@` header is rendered only through an explicit `<Decoration>` child. `.diff-code` is `white-space: pre-wrap; word-break: break-all`; the table is `width: 100%; table-layout: fixed`. All theme colors are `--diff-*` custom properties. No `exports` map, so `react-diff-view/esm/index.js` and `react-diff-view/style/index.css` resolve by path.

## Decisions (each is recorded in the contract doc update in Phase 1)

1. **Two modules, as the contract says.** `packages/web/src/lib/diff-hunks.ts` is the only caller of `structuredPatch` in the tree and produces `GitDiffHunk[]`; the existing adapter moves unchanged to `packages/web/src/lib/git-hunk-adapter.ts` and converts to `HunkData`. Neither renderer imports `diff`. `diff@9.0.0` is added as an exact pin to `packages/web/package.json`.
2. **The diff is the one sanctioned summary-time computation, and it must be O(1) per render.** `+n −m` is a collapsed-row badge and `N hunk(s)` is body-bar text, both composed in the summary path (`toolPresentation` → `toolRowPresentation`). That path does **not** run once per poll: `buildAgentHistory()` is called unmemoized in the render body at `NodeTranscriptPane.tsx:265`, `ConsoleNodeRoom.tsx:650`, and `ConsoleExecutionHistory.tsx:207`, so every React render re-runs `toolPresentation` for every visible row (red-team finding 1). Two memo layers make that acceptable: (a) `tool-presentation.ts` keeps a module-level `WeakMap<object, DiffHunksResult | null>` keyed on the input **record object** — the stored row's `payload.input`, which is the same object across renders until a poll replaces the page — so a re-render costs one identity lookup and never touches the strings; (b) `diff-hunks.ts` keeps a bounded string-keyed LRU so a poll that re-parses rows into new objects still reuses the computed hunks instead of diffing again. The ceiling rejects oversized input before any diff work, a per-side line ceiling (`MAX_DIFF_SIDE_LINES`) and `maxEditLength` together bound the Myers edit graph to a few million steps in the worst case, and `toolBodyPresentation()` hits the same memos. The `task` arm already computes its body at summary time, so there is precedent. Tests prove: repeated `toolPresentation` calls on one input object invoke the string differ once, and a second input object with equal strings invokes `structuredPatch` zero times.
3. **Both sides present means both values are strings.** The empty string counts as present (`new_string: ''` is a legitimate deletion). Presence is decided by the existing `BEFORE_AFTER_PAIRS` table; no second key list.
4. **Identical sides are not "no diff".** `structuredPatch` returns zero hunks; the module returns `{ hunks: [], added: 0, deleted: 0 }`, the row shows no badge, the body bar says `file · no changes`, and the body shows the path plus an explicit `no changes` note. Nothing is fabricated as a diff, and the preview is not shown as if it were one.
5. **A refusal is `null`.** Over-ceiling input, `maxEditLength` exceeded (`undefined` from jsdiff), or a thrown error all yield `null`: no badge, no hunk fact, body falls back to path plus preview exactly as today. The ceiling is measured honestly in UTF-8 bytes (`MAX_DIFF_SIDE_BYTES`) with a free pre-reject on `.length` (a string's UTF-8 byte count is never smaller than its code-unit length), because the story text says "byte ceiling". The bound is `maxEditLength`, never `timeout`, so the same pair yields the same answer on every machine.
6. **Line numbers are snippet-relative.** `FileEditInput` carries no file offset, so numbering starts at 1 in both columns; the mockup's `211` is unreachable and this is recorded as a known deviation, not a defect. The 3ch line-number column from DESIGN.md is kept because the adapter contract requires valid positive numbers anyway. The unified view's two gutter cells collapse to the mockup's single column: the `old` cell renders the marker plus the old number for `normal`/`delete` lines and the new number for `insert` lines; the `new` cell is hidden by scoped CSS.
7. **Hunk header rows only separate hunks.** A single-hunk diff (the mockup) renders no `@@` row. When there is more than one hunk, a `<Decoration>` row carrying the synthesized `@@ -a,b +c,d @@` header precedes every hunk after the first so elided context is visible.
8a. **Diff on raw sides, sanitize each rendered line.** The differ sees the exact strings; each emitted line's `content` is run through `sanitizeBounded` (control/ANSI stripping, per-line cap with a visible ellipsis) so a stored payload cannot draw a fake line break or hide text inside a numbered diff line.
8. **Failed edits keep their reason visible.** The diff box always renders when both sides are present. The normalized output text (today's `preview`) renders in a second box beneath it only when the row outcome is not `succeeded`; on success the provider's "file updated" prose stays behind Raw. The `unreadable` line is unchanged.
9. **Badge shape and tone.** Two badges of a new kind `diff`: `+n` (only when `n > 0`) with a new `success` tone (`var(--success)`, already measured ≥4.5:1 on both surfaces as the succeeded glyph) and `−m` (U+2212, only when `m > 0`) with the existing `danger` tone. `bodyBarText` drops `diff` badges (the hunk fact already states the change) exactly as it drops the task count badge, and `bodyFacts` now lead for every row (a behavior-preserving generalization: only task and file rows ever populate them).
10. **Scoped CSS lives in `index.css`.** Console cannot import `source-control-diff.css` (`@/components/**` is banned), and `index.css` already hosts the `.tool-family-body .hljs-*` overrides from Story 1.3. A `.tool-diff` block maps the `--diff-*` variables onto `--success`/`--error`/`--surface-inset`/`--text-secondary`, which both themes define. Line numbers use `--text-secondary` (the a11y review measured `--text-tertiary` at 2.71:1 on the inset surface). The `+`/`−` marker is the non-color cue and is exposed to assistive technology (not `aria-hidden`): unlike the redundant chevron, the sign is information.
11. **Memoization is bounded, LRU, and testable.** `createDiffHunks({ memoEntries, patch })` builds an instance with an insertion-ordered `Map` keyed on the two strings; a hit re-inserts the entry (delete + set) so eviction is least-recently-used, not FIFO, and the default instance keeps `DIFF_MEMO_ENTRIES = 256` (a long coding session shows far more than 64 distinct edits, red-team finding 3). Refusals are memoized too. `diffHunks` is the default instance. Tests construct their own instance to prove hit identity, LRU refresh, and eviction without test-only hooks.
12. **No Codex change.** Codex file changes are `system` messages; the story's Codex clause is satisfied by the one-sided and no-input `file` rows.

## Scope

In scope:

- `diff@9.0.0` dependency; `diff-hunks.ts` (+ tests); adapter move to `lib/` (+ test move, `api.generated` types, consumer import updates).
- `tool-presentation.ts`: file pair detection, summary badges and body facts, lazy `diff` on the file body arm, `success` tone, `diff` badge kind, body-bar generalization (+ tests).
- Inline diff rendering on **both** surfaces with scoped CSS, hunk separators, failure output box, no-changes note (+ component tests).
- Console isolation allowlist entry for `@/lib/git-hunk-adapter`; a boundary test that `structuredPatch` appears in exactly one module and neither renderer imports `diff`.
- e2e-fake `fileEdit` scenario, fixture workflow, runtime registration, Playwright proof on both surfaces (behavior, geometry at 1440 and 390, contrast of the new tones and tinted lines).
- Contract/test-plan doc updates, sprint status, implementation evidence.

Out of scope (state these so the verify step does not widen the work):

- Syntax highlighting inside the inline diff (`syntax-highlight.tsx` is a Legacy component Console cannot import; the mockup shows plain text).
- Virtualization, split view, per-file navigation, or a run-level "Files changed" panel (SPEC.md line ~158).
- File-offset line numbers (no data), word-level intra-line highlighting, whitespace-insensitive diffs.
- Any change to real providers' serialization, the pairing model, stored rows, or APIs.
- A shared React component between Legacy and Console (UX-DR3 forbids it); each surface keeps a local renderer.

## End-to-end behavior

```text
AgentHistoryItem (name, input, output)
  -> toolPresentation()                          # summary, runs on every poll
       file family + fileEditPair(input) both strings
         -> diffHunks(before, after)             # memoized; null when refused
              -> contentBadges: +n (success), −m (danger)   [kind 'diff']
              -> bodyFacts: 'N hunk(s)' | 'no changes', 'replace_all: <bool>'
  -> toolRowPresentation()                       # bodyBarText = family · facts · name · badges (minus diff)
  -> row open, Raw closed
       -> toolBodyPresentation(input, 'file')    # lazy
            -> { kind:'file', path, preview, unreadable, diff: {hunks, added, deleted} | null }
       -> renderer: path line
            diff !== null && hunks.length > 0 -> <Diff viewType="unified"> (+ Decoration between hunks)
            diff !== null && hunks.length === 0 -> 'no changes'
            diff === null -> preview | 'no preview' | unreadable   (today's arm)
            diff !== null && outcome !== 'succeeded' && preview !== null -> second box with preview
  -> Raw open: canonical payload, unchanged
```

`diff-hunks.ts` walks each jsdiff hunk's `lines` with running old/new counters: ` ` advances both and emits `normal`, `-` advances old and emits `delete`, `+` advances new and emits `insert`, and a line starting with `\` is skipped wherever and however often it appears. The header is synthesized as `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`.

## Acceptance criteria (measurable)

- [ ] `diffHunks` returns hunks whose `oldLine`/`newLine` values match hand-checked expectations for a marker mid-array and a marker twice in one hunk; returns `null` above `MAX_DIFF_SIDE_BYTES` without calling `structuredPatch`, and `null` past `MAX_DIFF_EDIT_LENGTH`; identical inputs return zero hunks; repeat calls return the identical (`toBe`) object; every produced hunk passes `toHunkData` without tripping `requiredLine()`.
- [ ] `toolPresentation` on an Edit with both sides yields `+n`/`−m` badges and `N hunk(s)` facts; one-sided, no-input, refused, and non-file rows yield neither; the differ runs once across repeated calls on the same row; the family is unchanged by the diff.
- [ ] Both surfaces render, for a both-sides row: the path, a `.tool-diff` unified table with the expected count of `diff-code-insert`/`diff-code-delete`/`diff-code-normal` cells, visible `+`/`−` markers and line numbers, no serialized JSON; for a one-sided or no-input row: today's path-plus-preview body and no `.tool-diff`; a failed row shows the output beneath the diff; a no-changes row shows `no changes`; Raw still swaps.
- [ ] The Console isolation test passes with `@/lib/git-hunk-adapter` approved; the boundary test proves exactly one `structuredPatch` call site and no `diff` import in either renderer; `virtualized-diff.tsx` and the moved adapter test still pass.
- [ ] Playwright proves the three fixture rows on Legacy and Console at 1440×1000 and 390×844 with no panel-level horizontal scrollbar, and records ≥4.5:1 for `+n` (success tone), `−m` (danger tone), and the diff line text and markers over the tinted line backgrounds on both themes; evidence is written under this plan's `reports/`.
- [ ] `bun --filter @archon/web test`, `bun --filter @archon/providers test`, `bun run validate`, and the new e2e spec pass; the contract docs are updated; `sprint-status.yaml` moves `1-4-view-a-file-edit-as-an-inline-diff` to `done` only after everything above is recorded.

## Phases

| #   | Phase                                                                                   | Dependency | Deliverable                                                                                      |
| --- | --------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| 1   | [Bounded differ, adapter move, presentation contract](./phase-01-start.md)              | none       | `diff` pin, `diff-hunks.ts`, adapter in `lib/`, file badges/facts/body diff, contract doc update |
| 2   | [Inline diff on Legacy and Console](./phase-02-two-surface-renderers.md)                | Phase 1    | unified diff rendering, scoped CSS, tone maps, component and boundary tests                      |
| 3   | [Deterministic full-stack proof and closeout](./phase-03-verification-and-closeout.md)  | Phases 1–2 | fake-provider scenario, fixture, Playwright proof, validation, evidence, sprint closeout          |

Deep mode note: Phase 1 is fully specified. Phases 2 and 3 are also written in full because the `ak-feature` workflow converts the whole directory into a Ralph PRD; each still gets a scout pass at execution time (`## Pre-edit integration check` sections) against the then-current tree.

## Global file inventory

| Path                                                                                                        | Action                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/web/package.json`, `bun.lock`                                                                     | add `"diff": "9.0.0"` (exact pin, like `react-diff-view`)                              |
| `packages/web/src/lib/diff-hunks.ts` / `.test.ts`                                                           | create bounded, memoized differ producing `GitDiffHunk[]`                              |
| `packages/web/src/lib/git-hunk-adapter.ts` / `.test.ts`                                                     | move from `components/workflows/source-control/`; types from `@/lib/api.generated`     |
| `packages/web/src/components/workflows/source-control/virtualized-diff.tsx`                                 | import path update only                                                                |
| `packages/web/src/lib/tool-presentation.ts` / `.test.ts`                                                    | file pair detection, `diff` badges, `success` tone, body facts, lazy `diff` on the arm |
| `packages/web/src/components/workflows/NodeRoom.tsx` + `NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx`       | Legacy inline diff, tone map, tests                                                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` + Console room tests  | Console inline diff, tone map, tests                                                   |
| `packages/web/src/experiments/console/console-isolation.test.ts`                                            | approve `@/lib/git-hunk-adapter` with a concrete-need comment                          |
| `packages/web/src/lib/diff-boundary.test.ts` (or a block in `console-isolation.test.ts`)                    | one `structuredPatch` module; renderers never import `diff`                            |
| `packages/web/src/index.css`                                                                                | `.tool-diff` scoped variables, hidden second gutter, marker colors                     |
| `packages/providers/src/e2e-fake/provider.ts` / `provider.test.ts`                                          | `fileEdit` scenario with pinned constants                                              |
| `e2e/fixtures/workflows/e2e-file-edit.yaml`, `e2e/lib/playwright/archon-runtime.ts`                         | fixture workflow and runner registration                                               |
| `e2e/ui/file-edit-diff.spec.ts`                                                                             | both-surface Playwright proof                                                          |
| `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`, `test-plan.md`                     | record decisions 2–11; align test bullets                                              |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`                                  | `1-4-…` → `done` at closeout                                                           |
| `plans/260919-0142-issue-177-inline-file-edit-diff/reports/implementation-evidence.md`                      | commands, results, contrast numbers, deviations                                        |

## Validation strategy (TDD)

Every phase writes the failing tests first, then the smallest implementation that turns them green, then refactors with the suite green. Commands, in order of scope:

```bash
cd packages/web && bun test src/lib/diff-hunks.test.ts src/lib/git-hunk-adapter.test.ts src/lib/tool-presentation.test.ts
cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/source-control/
cd packages/web && NODE_ENV=development bun test src/experiments/console/
bun --filter @archon/web test
bun --filter @archon/providers test
bun run --cwd e2e test:ui -- --grep 'file-edit'
bun run validate
```

Never run root `bun test`. The web package's `test` script already splits `src/lib/`, `src/components/`, and `src/experiments/console/` into separate processes; new tests fall into those legs by location and need no script change.

## Compatibility, rollout, and rollback

- No data migration: old and current call/result shapes flow through `projectToolTranscript` unchanged; rows without a pair render exactly as today.
- Performance: the summary-time differ is bounded (bytes, edit length) and memoized; the body arm is a cache hit; refused pairs cost one length check. Rendering is unbounded-safe because the differ's ceiling caps the hunk count.
- Rollback: revert the web changes and the dependency in one commit; the adapter move is mechanical and reverts with it. Stored data and public API are untouched.

## Risks and safeguards

- **`--error` over the delete-tinted background may fall below 4.5:1 on Legacy** (the a11y review measured 4.63:1 against plain inset). Phase 2 measures the marker and text tones in the component test's computed styles and, if the raw token fails, uses the existing danger mix (`color-mix(in oklch, var(--error) 75%, var(--text-primary))`) for the `−` marker; Phase 3 records the numbers.
- **The `\` marker semantics** are verified from jsdiff's pinned source; the fixtures in Phase 1 (`'a\nb'` → `'a\nb\n'`, and both sides ending without a newline with the last line changed) exercise them directly so a future jsdiff bump fails loudly.
- **CRLF content** keeps its `\r` inside line content (jsdiff default); no normalization option is passed, so an LF→CRLF rewrite honestly shows every line changed.
- **Snippet-relative numbering** could mislead a reader who expects file lines; it is recorded in the contract doc and evidence, and the design authority still asks for the column.

## Definition of done

All acceptance criteria above are checked with recorded evidence; the phase files' exit criteria are met; `bun run validate` is green; the PR uses the repository template, links `Closes #177`, and cites the contract doc changes; the sprint status entry is `done`.

## Task tracking

The phase files are the execution checklist. No external task-management surface is available in this session.

## Red Team Review

### Session — 2026-09-19 (headless)

Three hostile reviewers (Assumption Destroyer, Failure Mode Analyst, Security Adversary; Standard tier: Fact Checker + Contract Verifier) were launched against this directory, but the planning session was closed by the harness before any of them finished: **no `reports/redteam-*.md` file exists on disk and no finding has been adjudicated.** The red-team gate is therefore unmet. The next pipeline step (independent plan verify-and-fix) must perform that review itself against the four lenses above — verifying the plan's claims with `file:line` evidence, rejecting any evidence-free finding, applying accepted fixes to the phase files — and fill in the table below before the PRD is built. If a `reports/redteam-*.md` file has appeared by then (a reviewer that outlived the session), adjudicate it the same way rather than trusting it.

**Update (same day, after the return):** all three reports landed (`reports/redteam-assumption-destroyer.md`, `reports/redteam-security-adversary.md`, `reports/redteam-failure-mode-analyst.md`) and were adjudicated; the red-team gate is now met. The verify-and-fix step should re-check the applied fixes rather than redo the review.

**Findings:** 18 raw, 13 after de-duplication (12 accepted, 1 rejected). **Severity:** 2 Critical, 4 High, 7 Medium. Security 1/2/4 and Failure 1/3 duplicate Assumption 1–3 and share their fixes.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | `buildAgentHistory` runs unmemoized in the render body at three sites, so the summary-time differ runs per render, not per poll | Critical | Accept | plan.md decision 2; Phase 1 (`fileDiffFor` WeakMap on the input record object + render-cost test) |
| 2 | Multibyte byte-ceiling refusal happened before the memo key existed, so it was never cached despite the "refusals are memoized" rule | High | Accept | Phase 1 rules 1–2 (lookup before O(n) work; every outcome memoized) + test row |
| 3 | 64-entry FIFO cache thrashes on long coding sessions | High | Accept | plan.md decision 11; Phase 1 (`DIFF_MEMO_ENTRIES = 256`, LRU refresh on hit, LRU test row) |
| 4 | Adding required `diff` to the file body breaks the strict `toEqual` at `tool-presentation.test.ts:~1262` | Medium | Accept | Phase 1 (`diff: null` added to that assertion) |
| 5 | Unconditional `bodyFacts` in the bar is behavior-preserving only by current accident | Medium | Accept | Phase 1 (body-facts invariant table test) |
| 7 | Worst-case Myers cost at the byte ceiling with one-character lines is ~131M steps with no timeout (security 3) | High | Accept | Phase 1 (`MAX_DIFF_SIDE_LINES = 2_000` per side, checked after bytes, memoized; limit/limit+1 test) |
| 8 | Unsanitized diff content lets `\r`/control sequences fake line breaks inside a numbered line on an approval surface (security 5) | High | Accept | plan.md decision 8a; Phase 1 (per-line `sanitizeBounded` in the walk + test) |
| 9 | "Own top-level keys" pair detection is untested and the in-file precedent reads through the prototype chain (security 6) | Medium | Accept | Phase 1 (`Object.hasOwn` + prototype-key test) |
| 10 | Console gains its first third-party UI dependency with no boundary coverage (security 7) | Medium | Accept | Phase 2 boundary test names the exact `react-diff-view` imports |
| 11 | Phase 2's component-level contrast check cannot run under happy-dom (no `color-mix` resolution, no canvas) (failure 2) | Critical | Accept | Phase 2: contrast moved entirely to Phase 3 Playwright; fallback rule fixed in advance |
| 12 | First real `react-diff-view` mount in three large test files risks Bun's 5,000 ms timeout (failure 4) | Medium | Accept | Phase 2 risks: small fixtures, ≤3 diff rows per test, junit durations before any timeout change |
| 13 | `content`/`new_content` inference now drives an authoritative diff table (failure 5) | Medium | Accept | Phase 1 test: aliased non-file families with those keys get no diff |
| 6 | The Codex clause is proven only by a synthetic e2e-fake row, never through Codex's `system`-message path | Medium | Reject | Codex serializes `file_change` as a `system` message (`codex/provider.ts:709`), so no Codex tool row can exist to render; the story's clause is about a `file` row without both sides, which the fixture exercises. Documented under "Out of scope" and decision 12. |

### Whole-Plan Consistency Sweep

Re-read after applying: decision 2 and 11 in `plan.md`, Phase 1 contract/rules/tests, and Phase 2's handoff (unchanged — renderers still import only `FileDiff` and `toHunkData`) agree on the two memo layers, `DIFF_MEMO_ENTRIES = 256`, LRU semantics, the `patch` seam, the new `MAX_DIFF_SIDE_LINES` ceiling, and per-line sanitization (decision 8a supersedes the earlier "do not sanitize" sentence, which no longer appears anywhere). Phase 3's acceptance wording ("declared byte ceiling and `maxEditLength`") still holds; the line ceiling is an additional bound. Phase 2 no longer claims a component-level contrast measurement; Phase 3's Playwright contrast block is the single owner and its exit criterion is unchanged. No open items remain from the red-team gate.

## Validation Log

### Session — 2026-09-19 (headless, planner self-verification)

- Tier: Standard (3 phases). Claims spot-checked directly against the tree during planning: `BEFORE_AFTER_PAIRS` (`tool-presentation.ts:143`), `isTaskBody ? content.bodyFacts : []` (`tool-presentation.ts:815`), `BADGE_TONE` maps (`NodeRoom.tsx:326`, `ConsoleAgentHistoryList.tsx:267`), `GLYPH_TONE.succeeded = 'text-success'` on both surfaces, Console allowlist (`console-isolation.test.ts:~114`), `virtualized-diff.tsx` imports, e2e-fake `scenarioSchema` + `superRefine` exclusivity (`provider.ts:137-143`), `runTaskDispatchWorkflow` runner shape (`archon-runtime.ts:567`), `react-diff-view: 3.3.3` and no `diff` in `packages/web/package.json`, `diff@8.0.3` hoisted in `bun.lock`, existing `file · …` body-bar assertions that must keep passing (`NodeRoom.test.tsx:651`, `ConsoleNodeRoom.test.tsx:3059`). Verified: 13 | Failed: 0 | Unverified: 0 — the `Decoration` DOM was confirmed from `src/Decoration/index.tsx` + `UnifiedDecoration.tsx` at v3.3.3: `<tbody class="diff-decoration">` wrapping one `<tr>`; with a single child, one `<td class="diff-decoration-content" colSpan={3}>`; no anchors or `tabIndex`. `Hunk` renders `<tbody class="diff-hunk">`. The Phase 2/3 selectors (`.diff-decoration`) are therefore valid.
- Decision points were resolved by the planner with advisor review (no human available in the autonomous pipeline): summary-time diff with memo (decision 2), snippet-relative numbers (6), separator only between hunks (7), output beneath the diff on non-success (8), honest UTF-8 byte ceiling (5). Each is recorded under "Decisions" and is open to reversal by the verify step if repository evidence contradicts it.
