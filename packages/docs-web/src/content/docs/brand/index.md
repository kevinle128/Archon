---
title: Brand
description: Archon brand foundation — colors, logo, and usage guidelines.
---

## Quick reference

The essentials at a glance:

- **Primary gradient** — <code style="color:#ED10EC">#ED10EC</code> → <code style="color:#8E40C8">#8E40C8</code> → <code style="color:#06CE94">#06CE94</code>
- **Surface** — <code style="color:#0F1115;background:#fff;padding:0 6px;border-radius:3px">#0F1115</code>
- **Logo** — the shield mark with the abstract Archon glyph, stroked with the primary gradient

Use the embedded foundation below for the canonical version. If you need a vector asset or have a question about an unusual usage, open a discussion on [GitHub](https://github.com/coleam00/Archon/discussions).

## Full brand sheet

The Archon brand foundation lives below. It's a single self-contained page covering the logo, color system, typography, and approved usage.

<iframe
  src="/brand/foundation.html"
  title="Archon Brand Foundation"
  style="width:100%;height:80vh;border:1px solid var(--sl-color-gray-5);border-radius:8px;background:#0F1115;"
  loading="lazy"
></iframe>

Prefer a full-window view? [Open the brand sheet in a new tab](/brand/foundation.html).

## Run-view semantic tokens

A small set of scoped CSS custom properties is defined in `packages/web/src/index.css` under the `.legacy-run-view` and `.console-run-view` roots. These tokens apply **only inside those roots** and are not part of the sitewide design system.

| Token | Value | Usage |
|-------|-------|-------|
| `--rv-node-kind-size` | `0.625rem` | Graph node kind label |
| `--rv-node-label-size` | `0.8125rem` | Graph node name |
| `--rv-node-meta-size` | `0.6875rem` | Graph node duration, status, and metadata |
| `--rv-tab-size` | `0.6875rem` | Run-detail Log/Graph/Artifacts tab labels |
| `--rv-agent-font-size` | `12.5px` | Agent message text (`.pmsg-text`) |
| `--rv-agent-line-height` | `1.5` | Agent message line-height |
| `--rv-tool-card-bg` | `var(--surface-inset)` | Tool card inset background |
| `--rv-tool-card-border` | `1px solid var(--border)` | Tool card border |
| `--rv-tool-card-padding` | `8px 10px` | Tool card inner padding |
| `--rv-tool-io-font-size` | `11px` | Tool input/output pre-text |
| `--rv-ask-card-border-color` | `var(--warning)` | Ask card warning border |
| `--rv-ask-card-padding` | `12px 14px` | Ask card inner padding |

Do not use these tokens outside the run-view roots, and do not add new run-view tokens without updating this table.
