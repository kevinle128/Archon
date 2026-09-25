---
title: Brand
description: Archon brand foundation — colors, logo, and usage guidelines.
---

## Quick reference

The essentials at a glance:

- **Logo** — a pixel "A" on a 7x7 grid. Pixels use the text color. One accent pixel (the runner) steps across the crossbar only while a run is active.
- **Palette** — neutral surfaces and text with one indigo accent: <code style="color:#4F46E5">#4F46E5</code> in light mode and <code style="color:#818CF8">#818CF8</code> in dark mode. No gradients and no shadows.
- **Type** — Fira Sans for the interface, Fira Code for code, ids, and durations.
- **Motion** — meaningful motion only, 150 to 250ms transitions, all static under `prefers-reduced-motion`.

Use the embedded foundation below for the canonical version. If you need a vector asset or have a question about an unusual usage, open a discussion on [GitHub](https://github.com/coleam00/Archon/discussions).

## Color tokens

Light is the default. Dark follows the system setting and can be set by hand. The product defines these tokens in `packages/web/src/index.css`.

| Token | Light | Dark |
|-------|-------|------|
| Page background | `#FFFFFF` | `#0B0B0F` |
| Surface | `#F7F7F8` | `#141418` |
| Raised surface | `#EFEFF1` | `#1C1C22` |
| Border | `#E4E4E7` | `#2A2A31` |
| Text | `#18181B` | `#F4F4F5` |
| Secondary text | `#52525B` | `#A1A1AA` |
| Tertiary text | `#71717A` | `#8B8B94` |
| Accent | `#4F46E5` | `#818CF8` |
| Text on accent | `#FFFFFF` | `#0B0B0F` |
| Accent tint (user bubble, selection) | `#EEF0FF` | `#1E1B3A` |
| Success | `#15803D` | `#4ADE80` |
| Warning | `#B45309` | `#FBBF24` |
| Error | `#DC2626` | `#F87171` |

## Type and shape

- Interface text uses Fira Sans (400, 500, 600). Code, ids, node kinds, durations, and logs use Fira Code (400, 500).
- The type scale is 12, 14, 16, 20, and 28px. Body text is 14 to 16px with a line height of 1.5 or more.
- Cards and panels have a 12px radius. Inputs and buttons have a 10px radius. Status chips are full pills.
- Icons are Lucide-style SVG with a 1.5px stroke. Do not use emoji.

## Motion

Use motion only when it carries meaning: streaming agent text, the typing indicator while an agent works, the logo runner while a run is active, progress fill, and 150 to 250ms hover and expand transitions. Everything is static under `prefers-reduced-motion: reduce`.

## Full brand sheet

The Archon brand foundation lives below. It is a single self-contained page covering the logo, color system, typography, shape, and motion.

<iframe
  src="/brand/foundation.html"
  title="Archon Brand Foundation"
  style="width:100%;height:80vh;border:1px solid var(--sl-color-gray-5);border-radius:8px;background:#FFFFFF;"
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

Do not use these tokens outside the run-view roots, and do not add new run-view tokens without updating this table.

## Node room status pill borders

The node room headers draw their status pill outlines from sitewide tokens in `packages/web/src/index.css` (`:root`). The running, success, and error tones blend their status hue into `--background`, so the outline reads on `--surface` without competing with the pill text. The warning tone blends `--warning` over a transparent base.

| Token | Value | Usage |
|-------|-------|-------|
| `--status-pill-border-running` | `color-mix(in srgb, var(--accent) 40%, var(--background))` | Running pill outline |
| `--status-pill-border-success` | `color-mix(in srgb, var(--success) 40%, var(--background))` | Completed pill outline |
| `--status-pill-border-error` | `color-mix(in srgb, var(--error) 40%, var(--background))` | Failed pill outline |
| `--status-pill-border-warning` | `color-mix(in oklch, var(--warning) 40%, transparent)` | Recovery-required pill outline |
