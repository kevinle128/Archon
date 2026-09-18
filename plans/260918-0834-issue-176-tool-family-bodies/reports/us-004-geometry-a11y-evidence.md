# US-004 Geometry + Accessibility Evidence — Console `ToolBody` renderer

**Date:** 2026-09-28
**Surface:** `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` (`ToolHistory` expanded region: family bar + `ToolBodySwitch` + Raw swap).
**Scope note:** Console mounts the same `.tool-family-body` box as Legacy via a local, surface-owned `TOOL_BODY_BOX` — no Legacy React component is imported; only the shared data contract (`toolBodyPresentation`, `sanitizeBounded`) crosses the boundary.

## Geometry at the contractual 460px panel

Panel width is set by `--rv-panel-default-width: 460px` (`packages/web/src/index.css:349`).

| Property         | Value                              | Source                                                             |
| ---------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Body box element | `<div class="tool-family-body …">` | `TOOL_BODY_BOX` in `ConsoleAgentHistoryList.tsx`                   |
| Border           | 1px `border-border`                | `rounded-[6px] border border-border`                               |
| Radius           | 6px                                | `rounded-[6px]`                                                    |
| Padding          | 8px vertical / 10px horizontal     | `py-2` / `px-2.5`                                                  |
| Surface          | `--surface-inset`                  | `bg-surface-inset`                                                 |
| Typography       | 11.5px / 1.5 monospace             | `font-mono text-[11.5px] leading-[1.5]`                            |
| Wrapping         | pre-wrap + break-anywhere          | `whitespace-pre-wrap`, inline `overflow-wrap: anywhere`, `min-w-0` |

No horizontal panel scroll at 460px: the body box is `min-w-0` inside a block column and wraps with `pre-wrap`/`overflow-wrap:anywhere`; the family bar is a flex row whose text span is `min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap` (one line, ellipsized) and whose Raw button is `flex-none` pinned last (far right). The row summary is `overflow-hidden` with `items-baseline`, a `min-w-0 flex-1` headline and a `whitespace-nowrap` badge run whose duration badge is `flex-[0_1_auto]` shrinkable — one line at 460px by construction.

## Raw swap slot (mirrors the US-003 Legacy slot; issue #175 still open)

- State anchor: `rawOpen` boolean in `ToolHistory`; toggle is the single `button[aria-expanded]` in the row (`aria-expanded={rawOpen}`, `▾` marker while open).
- Closed row mounts nothing (`{open ? … : null}`); open row mounts the bar + body. `rawOpen === true` swaps `ToolBodySwitch` for the exact `formatToolIo({name, input, output})` payload in the same `.tool-family-body` box; closing restores the body.
- Laziness: `toolBodyPresentation` is invoked only inside `ToolBodySwitch`'s `useMemo`, which mounts only while `open && !rawOpen`. Test-verified: 0 calls collapsed, 0 added calls while Raw is open (including a full-output fetch under Raw), exactly +1 call on body mount and +1 recomputation after full-output load (with the fetched `output`).

## Keyboard order and focus

Tab order inside an open row is DOM order: `summary` → Raw `button` → `View full output` → `Retry` (test asserts `summary, button` query order: summary first, Raw second). Activation is native Enter/Space on `<summary>`/`<button>`. Focus ring: `focus-visible:outline-2 focus-visible:outline-accent-bright!`; Console keeps its surface delta `focus-visible:outline-offset-2` (+2px, not Legacy's −2px). Minimum target size: Raw is `min-h-[24px]`; summaries are `min-h-[24px]`.

## Screen-reader pass

- Terminal body (`Bash`, failed): announces `$ npm test` `boom` `FAILED` — the failure is a word, not color alone (span carries `font-bold` + `color-mix(--error 75%, --text-primary)`).
- Matches body (`Grep` content mode): announces `fn x` `in crates/` then `src/a.ts:12 hit` / `plain tail` — path, line, and text are plain text nodes in reading order.
- The body bar is readable text (`file · exit 2 · truncated · 1.5s`); Raw exposes `aria-expanded` so its state is announced. `text-text-tertiary` is never used for required content (aria-hidden decorations only).

## Reduced motion

The only animated property in the row is the chevron `transition-transform duration-[120ms]`, which carries `motion-reduce:transition-none`; bodies, bar, and Raw swap introduce no animation. Unchanged by this story.

## Contrast

Identical tokens and box to US-003 — see `reports/us-003-contrast-evidence.md` for the measured table (all required-content tones ≥ 4.5:1 on `--surface-inset`: `--text-primary` 16.52, `--text-secondary` 6.28, `--node-bash` 8.92, `--node-command` 5.56, FAILED mix 6.65, hljs mixes 6.90/6.76/6.28). The scoped `.tool-family-body .hljs-*` rules in `index.css` apply to both surfaces. Focus ring `--accent-bright` on the dark transcript surfaces measures 8.19:1 vs `--surface-inset`.

## Commands and results

- `cd packages/web && NODE_ENV=development bun test src/experiments/console/` — 912 pass / 0 fail (83 files).
- `cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx` — 59 pass / 0 fail.
- `bun --filter @archon/web test` — 2085 pass / 0 fail across all shards.
- `bun run type-check` — clean, all packages.
- `bun run lint --max-warnings 0` — clean.
- `bun run format:check` — clean after `prettier --write` on the two touched files.
