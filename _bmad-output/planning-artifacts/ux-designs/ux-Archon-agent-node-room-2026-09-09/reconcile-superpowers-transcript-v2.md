# Reconcile — imports/superpowers-transcript-v2.html

Brainstorm mockup: option B applied to the full transcript, four hard cases, status-glyph options 1 / 2 / 3.
The transcript body repeats v1; its rows are reconciled in `reconcile-superpowers-transcript-v1.md` and not repeated here.
Authority: `.memlog.md` (cited as memlog L<n>); screens `.working/key-*.html`; contract `tool-presentation-contract.md`.

> **Point-in-time record.** This file describes the reconciliation as it stood at mock review. Three of its statements were superseded afterwards and are left in place so the trail is readable: the six-treatment mapping and `code = --node-script` (the user chose amber; memlog L36), the chip that "truncates with an ellipsis" (the contract makes it fall back to the family name), and the four-glyph set (`⚠` was added for `interrupted`). The spines win on every conflict.

## Carried

- Chip = tool name on every row (subtitle "Tên tool là chip") → memlog L9 "density option B = tool name as chip"; `.fam` in all three screens; contract "Chip".
- Middle elision so the filename survives (subtitle + hard case 1 "cắt GIỮA, tên file luôn còn") → memlog L9 "long paths elide in the MIDDLE so the filename survives"; contract `headlineKind: 'path'`; states sheet hard case 1 reuses the same example path and translates the note ("A tail cut would have shown … — useless").
- Subtitle rationale "gets C's main benefit without double height" → the reason option C fell (v1 reconcile).
- `.hl { min-width: 0 }`, added in v2 and absent in v1 → contract: "The headline element needs `min-width: 0` inside the flex row or it will not shrink."
- Hard case 2, Codex: chip is the **family** `shell`, the command becomes the headline, no input ("nếu nhét cả dòng lệnh vào chip thì chip vỡ") → contract Tier 3 ("4,911 of 22,867 rows … a main path") and the chip fallback rule; states sheet hard case 2.
- Hard case 3, MCP: `mcp__gitnexus__query` → `gitnexus · query`, precedent `tool-formatter.ts:70` → contract "An MCP name resolves to `generic` with label `server · tool`, following the existing convention in the backend formatter"; states sheet hard case 3, same chip text. Verified: `packages/workflows/src/utils/tool-formatter.ts:70` splits on `__` and joins with a space — the `·` separator is this run's choice.
- Hard case 4, unknown tool: up to three scalar `key: value`, `{…}` / `[n]`, never JSON → memlog L9; contract Tier 4; states sheet hard case 4. The `—` empty-badge placeholder is carried as-is.
- "4 ca khó — đây mới là chỗ thiết kế dễ vỡ" (the hard cases are where it breaks) → states sheet §C structure: one clean row per family, then the four hard cases.
- Glyph option 1 `✓ ✕ ◐`, caption "colour-blind users still distinguish by shape" → memlog L9 "plus colour, never colour alone"; contract "Colour is applied in addition to the glyph"; states sheet §B "Four different shapes. A colour-blind reader loses nothing."
- Italic `.note` captions under each hard case → same device in the states sheet.

## Transformed

- Hex → token map as in the v1 reconcile, plus v2's own colours: `#7ee787` shell chip → `--node-bash` amber, not green; `#79c0ff` MCP chip → `--text-secondary` (folded into generic); `#d2a8ff` default chip → split by family.
- Chip colouring: v2's four ad-hoc classes (default purple, `.sh` green, `.mcp` blue, `.gen` grey) → user chose per-family colour (memlog L17) and confirmed six treatments, shell=node-bash · file+web=node-command · search+glob=node-prompt · code=node-script · todo+task=node-approval · generic=text-secondary (memlog L18, L23), with a legend (states sheet §A). Reason: hues must trace to existing tokens and sit below the status colours in salience.
  **Concern**: `--node-script` exists only in `packages/web/src/experiments/console/theme.css:88` — its comment reads "script and cancel exist only here (console-scoped) until the production palette needs them" — and `packages/web/src/index.css` has no such token. key-legacy and the states sheet hardcode `--node-script: oklch(0.68 0.17 120)`, which matches neither Console's `oklch(0.7 0.14 140)` nor anything in index.css. memlog L18 ("every hue an existing --node-\* token so both surfaces already have it") and L23 ("No new tokens") are wrong for the `code` family on Legacy.
- Middle elision: v2 keeps the parent directory beside the filename (`packages/web/src/…/inspect/ConsoleAgentHistoryList.tsx`) → the mock's two-span CSS keeps leading segments plus the filename only (`packages/web/src/experiments/cons…ConsoleAgentHistoryList.tsx`); the parent directory is the first thing lost. memlog L22 fixed head flex-grow, not this. See Dropped.
- Hard case 2 example: one-line `&&` chain → seven-line loop; adds first-non-empty-line + `…` headline, a "tool name · 7 lines" tbar, and the `/bin/zsh -lc '` unwrap (memlog L19, L25).
- Hard case 4 example `notebook_edit` → `get_command_or_subagent_output`, because contract Tier 1 now maps `notebookedit` to file (write): the import's "unknown" tool is no longer unknown. A chip over 24ch truncates with an ellipsis inside the pill (states sheet note).
- Glyph set grows from three to four: `–` for unknown outcome / output missing (contract "Status glyph ✓ ✕ ◐ –"; memlog L26 reserves `–` for a genuinely unknown outcome). Glyphs rendered bold (700).
- "Attempt 1 / Attempt 2 · sau retry" → "Run N" (memlog L24; v1 reconcile).

## Dropped

- Glyph option 2 "Chấm tròn màu" — rejected by user (memlog L9). Its own caption gives the reason ("chỉ còn màu để phân biệt"). The AionUi comparison was never picked up; nothing depends on it.
- Glyph option 3 "Vạch trái, chỉ tô khi bất thường" — rejected by user (memlog L9). **Never picked up**: its rationale — "success is completely silent; only errors and running surface; least noise when the run is all green" — fell with the bar. In key-console every success is a bold, full-strength green ✓ (11 of them against one ✕). memlog L26 already dims ✓ to opacity .55 for collapsed `todo updated` rows, so a hybrid (option 1 shapes, muted ✓ on collapsed successes) was within reach and no memlog line considers it.
- **Never picked up**: parent-directory retention inside the middle elision (`…/inspect/File.tsx`). The import's example preserved it; the mocks' CSS cannot; no decision records the loss.
- **Never picked up**: a distinct chip hue for MCP tools (v2 `.chip.mcp` blue). Superseded by the contract (MCP → generic) without a memlog decision; an MCP row now looks like any unknown tool.
- v2 body margin 33px and the grey `.cap` section captions — presentation only.
