---
title: Brand
description: Archon brand foundation — colors, logo, and usage guidelines.
---

## Quick reference

The essentials at a glance:

- **Logo** — a pixel "A" on a 7x7 grid. Pixels use the text color. One accent pixel (the runner) steps across the crossbar only while a run is active.
- **Palette** — a navy top bar over a light page with one blue accent: <code style="color:#2563EB">#2563EB</code> in light mode and <code style="color:#8B9BFF">#8B9BFF</code> in dark mode (the midnight palette). No gradients, no shadows, no rounded corners.
- **Type** — Archivo for all interface text, 800 for headings. Mono is `ui-monospace, Menlo, monospace`. Numerals are tabular.
- **Motion** — the streaming caret and live timers only. The caret is static under `prefers-reduced-motion`.

Use the embedded foundation below for the canonical version. If you need a vector asset or have a question about an unusual usage, open a discussion on [GitHub](https://github.com/coleam00/Archon/discussions).

## Color tokens

Light is the default. Dark uses the midnight palette, follows the system setting, and can be set by hand. The product defines these tokens in `packages/web/src/index.css`. All values are the exact handoff palette. Some small status and tertiary text on light surfaces is below WCAG AA (4.5:1); this is a deliberate product decision. `--accent-hover` (`#1D4ED8`) is for hover only.

| Token | Light | Dark |
|-------|-------|------|
| Page background (`--background`) | `#F5F7FA` | `#0F1218` |
| Surface (`--surface`) | `#EAEEF3` | `#161A22` |
| Cards and inputs (`--surface-elevated`, `--card`) | `#FFFFFF` | `#1C2230` / `#161A22` |
| Line (`--border`) | `#E2E6ED` | `#232A36` |
| Strong line (`--line-strong`, `--border-bright`) | `#C9D0DB` | `#2E3746` |
| Selection (`--selection`) | `#E4ECFB` | `#1C2230` |
| Text (`--text-primary`) | `#1A2130` | `#E6E8EE` |
| Secondary text (`--text-secondary`) | `#5A6478` | `#9AA3B2` |
| Tertiary text (`--text-tertiary`) | `#98A1B2` | `#667085` |
| Accent and running (`--accent`) | `#2563EB` | `#8B9BFF` |
| Accent text on tints (`--accent-bright`) | `#2563EB` | `#A5B1FF` |
| Text on accent (`--on-accent`) | `#FFFFFF` | `#0F1218` |
| Top bar (`--header-bg`) | `#1A2130` | `#0F1218` |
| Top bar text (`--header-fg`) | `#F1F4F9` | `#E6E8EE` |
| Top bar muted text (`--header-muted`) | `#9AA5B8` | `#9AA3B2` |
| Top bar line (`--header-line`) | `#2C364A` | `#2E3746` |
| Top bar accent (`--header-accent`) | `#7AA2FF` | `#8B9BFF` |
| Code block (`--code-bg`) | `#1A2130` | `#0A0C11` |
| Code text (`--code-fg`) | `#E6E9F0` | `#CDD3DE` |
| Error tint (`--tint-error`) | `#FDECEA` | `#2A1A1D` |
| Success tint (`--tint-success`) | `#E7F6EC` | `#14261E` |

## Status language

One glyph, label, and color per state. The map lives in `packages/web/src/lib/status-presentation.ts`; every screen reads it.

| State | Glyph | Label | Light | Dark |
|-------|-------|-------|-------|------|
| Running | ▶ | Running | `#2563EB` (`--status-running`) | `#8B9BFF` |
| Paused or awaiting | ! | Awaiting you | `#D97706` (`--status-waiting`) | `#F0A54A` |
| Done or completed | ✓ | Done / Completed | `#16A34A` (`--status-done`) | `#5FBF8F` |
| Failed | ✕ | Failed | `#DC2626` (`--status-failed`) | `#F07167` |
| Pending | ○ | Pending | `#98A1B2` (`--status-pending`) | `#667085` |
| Skipped or cancelled | – | Skipped / Cancelled | `#98A1B2` | `#667085` |

The waiting chip is filled with `--status-waiting`. Its text uses `--status-waiting-fg` (`#FFFFFF` in light, `#0F1218` in dark). A progress strip has one 4px segment per node with 2px gaps. A pending segment uses `--segment-pending` (`#D3D9E3` light, `#2E3746` dark).

## Type and shape

- All interface text uses Archivo (400, 600, 700, 800). Headings use 800. Code, ids, durations, and logs use `ui-monospace, Menlo, monospace`. Numerals are tabular.
- Sizes in use are 44, 28, 24, 22, 20, 19, 18, 16, 15, 14.5, 14, 13, 12, 11, and 10px. Section labels are 11px, uppercase, with 0.08em letter spacing.
- Radius is 0 everywhere and nothing casts a shadow. Major dividers are 2px rules and row dividers are 1px.
- A selected list row has a 3px accent bar on the left and the selection background.
- The keyboard focus ring is a 2px accent outline with a 2px offset.
- Icons are glyph characters or Lucide-style SVG. Do not use emoji.

## Motion

Two things move: the streaming caret (an 8px block that blinks in 1s steps) and live timers that count up. The logo runner steps across the crossbar while a run is active. The caret and the runner are static under `prefers-reduced-motion: reduce`.

## Full brand sheet

The Archon brand foundation lives below. It is a single self-contained page covering the logo, color system, typography, shape, and motion.

<iframe
  src="/brand/foundation.html"
  title="Archon Brand Foundation"
  style="width:100%;height:80vh;border:1px solid var(--sl-color-gray-5);border-radius:0;background:#FFFFFF;"
  loading="lazy"
></iframe>

Prefer a full-window view? [Open the brand sheet in a new tab](/brand/foundation.html).

## Run-view semantic tokens

A small set of scoped CSS custom properties is defined in `packages/web/src/index.css` under the `.legacy-run-view` root. These tokens apply **only inside that root** and are not part of the sitewide design system.

| Token | Value | Usage |
|-------|-------|-------|
| `--rv-node-kind-size` | `0.625rem` | Graph node kind label |
| `--rv-node-label-size` | `0.8125rem` | Graph node name |
| `--rv-node-meta-size` | `0.6875rem` | Graph node duration, status, and metadata |
| `--rv-tab-size` | `0.6875rem` | Run-detail Log/Graph/Artifacts tab labels |
| `--rv-agent-font-size` | `14px` | Agent message text |
| `--rv-agent-line-height` | `1.5` | Agent message line-height |
| `--rv-tool-card-bg` | `var(--surface-inset)` | Tool card inset background |
| `--rv-tool-card-border` | `1px solid var(--border)` | Tool card border |
| `--rv-tool-card-padding` | `8px 10px` | Tool card inner padding |
| `--rv-tool-io-font-size` | `12px` | Tool input/output pre-text |
| `--rv-ask-card-border-color` | `var(--accent)` | Ask card accent border |
| `--rv-ask-card-padding` | `12px 14px` | Ask card inner padding |
| `--rv-panel-default-width` | `460px` | Inspect panel default width |
| `--rv-panel-min-width` | `320px` | Inspect panel minimum width |
| `--rv-panel-max-width` | `720px` | Inspect panel maximum width |

Do not use these tokens outside the run-view roots, and do not add new run-view tokens without updating this table.

## Node room status pill borders

The node room headers draw their status pill outlines from sitewide tokens in `packages/web/src/index.css` (`:root`). The running, success, and error tones blend their status hue into `--background`, so the outline reads on `--surface` without competing with the pill text. The warning tone blends `--warning` over a transparent base.

| Token | Value | Usage |
|-------|-------|-------|
| `--status-pill-border-running` | `color-mix(in srgb, var(--accent) 40%, var(--background))` | Running pill outline |
| `--status-pill-border-success` | `color-mix(in srgb, var(--success) 40%, var(--background))` | Completed pill outline |
| `--status-pill-border-error` | `color-mix(in srgb, var(--error) 40%, var(--background))` | Failed pill outline |
| `--status-pill-border-warning` | `color-mix(in oklch, var(--warning) 40%, transparent)` | Recovery-required pill outline |
