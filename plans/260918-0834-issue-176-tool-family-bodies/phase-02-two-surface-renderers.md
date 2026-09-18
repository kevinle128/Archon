---
phase: 2
title: 'Phase 2: Legacy and Console family bodies'
status: pending
priority: P1
effort: '1.5d'
dependencies: [1]
---

# Phase 2: Legacy and Console family bodies

> Deep-mode outline. A dedicated scout pass runs before execution to re-read the Story 1.2 renderer changes as merged and refresh the line anchors below.

## Goal

Render `presentation.body` in the Story 1.2 swap slot on both node rooms with thin, surface-owned JSX and existing tokens, so an expanded row shows a terminal, path list, match list, code block, web result, file preview, or key-value list — and never JSON.

## Context links

- DESIGN tokens and components: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md:219-236` (body-box), `:256-257` (kv-list), `:587-597`, `:613`
- EXPERIENCE body rows: `.../EXPERIENCE.md:112-124`
- Mockup: `.../mockups/key-transcript-states.html` §D (every arm drawn once per family)
- Renderers: Legacy `packages/web/src/components/workflows/NodeRoom.tsx` (`ToolHistory` `:314-476`, markdown pipeline `:43-95`); Console `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` (`ToolHistory` `:237-385`, markdown pipeline `:35-38`). **Anchors move once 1.2 merges; re-scout.**
- 1.2 plan structure: `plans/260918-1038-issue-175-raw-payload-toggle/plan.md` — body bar + `Raw` button, `{rawOpen ? <pre raw> : null}` slot, `View full output` after the slot, `useId()` ids, Console mounted twice per page.

## Pre-execution gate

- [ ] Story 1.2's PR is merged into `develop` and this branch is rebased on it. If not, **stop and coordinate** — both stories edit the same component tests and body area. Do not implement against the 1.1 bridge.

## Requirements

- [ ] Each family renders its declared arm on both surfaces inside a `body-box` (`surface-inset`, 1px `border`, radius 6px, padding `8px 10px`, `11.5px`/1.5 mono, `pre-wrap`, `overflow-wrap: anywhere`).
- [ ] Terminal: `$` sigil in `node-bash`, the command (full, multi-line), output preformatted; `FAILED` bold in error tone when `outcome === 'failed'`; `no output` / `awaiting output` (running) / `output not readable — open Raw` (unreadable) states in text-secondary.
- [ ] Matches: pattern and scope line; each item as path in `node-command`, `:line` in text-secondary, then text; non-parsed lines as plain text; `+n more` when `overflow > 0`.
- [ ] Paths: pattern/scope line; one `node-command` path per line; `+n more`.
- [ ] Code: source rendered through the surface's `ReactMarkdown` + `rehypeHighlight` as a fenced block (fence longer than the longest backtick run, language sanitized `[A-Za-z0-9_+.-]`, `rehypePlugins` only); result in a second box 6px below.
- [ ] Web: URL header (plain text, not a link — no navigation from stored data), title beneath when present, markdown body through the existing pipeline.
- [ ] File: path header in `node-command`, preview preformatted; `no preview` when null.
- [ ] Generic: kv-list (key text-secondary at `11ch`, value text-primary, `{…}` / `[n]` literal); output as markdown when text, as a second kv-list when fields, absent otherwise.
- [ ] The body renders **only when the row is open and Raw is closed**, in the 1.2 slot; `View full output` position and behaviour unchanged; a full-output load refreshes the body (already re-presented via `hasFullOutput`).
- [ ] Console imports nothing from `@/components/`; both surfaces use their own token roots and focus offsets; no shared React component.

## Architecture

```text
ToolHistory (per surface)
  presentation = hasFullOutput ? toolRowPresentation(…full…) : item.presentation   (1.1)
  <details>
    <summary>…</summary>
    <div body>
      <BodyBar … Raw/>                                  (1.2)
      {rawOpen ? <pre raw/> : <ToolBody body={presentation.body} outcome={presentation.statusLabel} />}
      View full output / error / Retry                  (1.1/1.2)
```

`ToolBody` is a local function component in each renderer file (Legacy in `NodeRoom.tsx`, Console in `ConsoleAgentHistoryList.tsx`) switching on `body.kind`. Helpers that are pure and identical on both surfaces — `fencedCodeMarkdown(source, language)` and `MatchItem` formatting — live in `packages/web/src/lib/tool-output.ts` or `tool-presentation.ts`, not in a shared component.

## Related code files

- Modify: `packages/web/src/components/workflows/NodeRoom.tsx`, `packages/web/src/components/workflows/NodeRoom.test.tsx`, `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`
- Modify: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`, `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`, `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` (if it asserts body content)
- Modify (if the fence helper lands there): `packages/web/src/lib/tool-output.ts` + test

## File inventory

| File                                                                                   | Action | Size    | Test impact                                    |
| -------------------------------------------------------------------------------------- | ------ | ------- | ---------------------------------------------- |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                   | modify | +180 L  | `NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx` |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                              | modify | +120 L  | —                                              |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                        | modify | +80 L   | interactive matrix (happy-dom)                 |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`  | modify | +180 L  | `ConsoleNodeRoom.test.tsx`                     |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`             | modify | +120 L  | —                                              |
| `packages/web/src/lib/tool-output.ts` (+ test)                                         | modify | +30 L   | fence helper table                             |

## Implementation steps (outline)

1. Scout pass: read both renderers as merged with 1.2; record the slot anchors and the body-bar contract; confirm `Raw` state variable names.
2. Tests before (red): static anatomy per arm on both surfaces (see matrix); the "no JSON while Raw closed" sweep extended to every family fixture; keyboard/focus unchanged.
3. Implement Legacy `ToolBody`; make Legacy tests green.
4. Implement Console `ToolBody` with Console tokens and `+2px` focus offset; make Console tests green; isolation test green.
5. Refactor: pull any pure formatting duplicated three times into lib; keep JSX per surface.
6. Regression gate.

## Test scenario matrix

| Path     | Scenario                                                                                              | Surface | Rows           |
| -------- | ----------------------------------------------------------------------------------------------------- | ------- | -------------- |
| Critical | Shell row open: `$` sigil + command + output text; `exit 1` row shows `FAILED`; no `{` in body        | both    | Claude + Codex |
| Critical | Search content row: items render path, `:line`, text; `files_with_matches` row renders flat paths     | both    | Claude + OMP   |
| Critical | Generic row (unknown tool, object input/output): ≤3 kv rows, `{…}`/`[n]` literal, no JSON             | both    | any            |
| Critical | Raw open swaps the family body out; Raw closed restores it; `View full output` count stays 1          | both    | any            |
| High     | Code row: `<code class="hljs language-python">` present; unknown language still renders source        | both    | OMP-style      |
| High     | Web row: URL header text, title when present, markdown body rendered (a heading element appears)      | both    | Claude         |
| High     | File row: path header + preview; Claude `Edit` shows `new_string` preview; unreadable state message   | both    | Claude + OMP   |
| High     | Truncated-at-rest Claude Bash row shows salvaged stdout, `truncated` badge still on the summary       | both    | Claude         |
| High     | Devin byte-array shell row shows decoded text                                                          | both    | Devin          |
| Medium   | 501-line paths output shows 500 rows + `+1 more`                                                      | both    | any            |
| Medium   | Full-output load on a paths row refreshes the item list (post-load body differs from pre-load)        | both    | any            |
| Medium   | Todo/task rows show the generic kv body; headline `todo updated` unchanged                            | both    | Claude + OMP   |
| Medium   | Body box tokens: `surface-inset` background class, mono size, `pre-wrap` computed style               | both    | any            |

## Tests before / Refactor / Tests after

- **Tests before**: red anatomy tests per arm and the swap interaction on both surfaces; extend the existing "no serialized JSON while Raw closed" sweep (from 1.2) with one fixture per family.
- **Refactor**: replace the empty 1.2 slot with `<ToolBody/>`; no change to summary, body bar, Raw, or full-output code paths.
- **Tests after**: per-arm assertions green; existing 1.1/1.2 anatomy, keyboard, focus, and disclosure tests green unchanged.

## Regression gate

```bash
cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx
cd packages/web && NODE_ENV=development bun test src/experiments/console/
bun --filter @archon/web test && bun run type-check && bun run lint --max-warnings 0
```

## Dependency map

- Depends on Phase 1 (`presentation.body`, `tool-output` helpers) and on Story 1.2 merged.
- Blocks Phase 3 (E2E/visual evidence needs the bodies on screen).

## Todo

- [ ] Pre-execution gate satisfied (1.2 merged, branch rebased)
- [ ] Scout pass recorded slot anchors
- [ ] Red body tests on both surfaces
- [ ] Legacy `ToolBody` green
- [ ] Console `ToolBody` green; isolation test green
- [ ] Regression gate green

## Success criteria

- Every arm visible on both surfaces with tokens from the design system; no JSON in any default body; Raw swap intact; all package tests green.

## Risk assessment

| Risk                                                                    | Signal                                          | Response                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| 1.2 lands with a different slot shape than its plan                     | Scout pass finds no `rawOpen` slot              | Adapt to the merged shape; body still renders only while Raw is closed            |
| Fenced-markdown code rendering mangles a source containing `~~~`/```    | Fence-collision test fails                      | Fence = longest backtick run + 1 (min 3); tilde sources are safe in backtick fences |
| Large bodies slow the room with many open failed rows                   | Test with 40 open rows renders slowly           | Bodies are capped in Phase 1; render `+n more` instead of the tail                |

## Security considerations

- The web arm's URL is rendered as text, not as an anchor, so stored data cannot become a click target. Markdown rendering reuses the existing sanitized `ReactMarkdown` pipeline (no `rehype-raw`).
- No `dangerouslySetInnerHTML` is introduced.
