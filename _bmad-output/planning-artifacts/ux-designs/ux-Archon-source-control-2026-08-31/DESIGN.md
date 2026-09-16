---
status: final
created: 2026-09-01
updated: 2026-09-01
name: Archon Source Control tab
description: Visual identity for the read-only, run-scoped git-inspector tab on the Archon workflow-run screen — Source-Control-specific deltas over the inherited Archon web design system.
inherits: Archon web design system (React 19 + Tailwind v4 + shadcn/Radix primitives)
sources:
  - ../../prds/prd-source-control/prd.md
  - ../../prds/prd-source-control/architecture.md
  - ../../prds/prd-source-control/addendum.md
  - ../../epics-source-control/epics.md
supplementalSources:
  - ../../prds/prd-source-control/implementation-readiness-report-2026-08-31.md
  - ../../prds/prd-source-control/reconcile-source-control.md
  - ../../prds/prd-source-control/review-source-control.md
references:
  - imports/vscode-source-control-reference.md
colors:
  # Source-Control-specific deltas ONLY. Everything not listed (background,
  # foreground, muted, muted-foreground, card, border, input, ring, popover,
  # accent, primary, destructive) inherits the Archon shadcn/Tailwind tokens.
  # Diff line tints are subtle backgrounds — NOT `destructive` strength. The
  # exact hex is bound at build from the Archon palette / react-diff-view theme
  # (see Open Questions); values below are semantic references, not fabricated.
  diff-removed-bg: 'extends {colors.destructive} — subtle red line tint (before)'
  diff-added-bg: 'ADD green-tint token — no shadcn default; bind to Archon palette green at build'
  diff-removed-gutter: 'inherits {colors.destructive} foreground for the `-` marker'
  diff-added-gutter: 'ADD green-foreground token for the `+` marker; bind at build'
  badge-M-fg: 'inherits {colors.foreground} on {colors.muted} — letter-carried, not color-only'
  badge-A-fg: 'inherits {colors.foreground} on {colors.muted} — letter-carried, not color-only'
  badge-D-fg: 'inherits {colors.foreground} on {colors.muted} — letter-carried, not color-only'
typography:
  # Inherits the Archon sans ramp for chrome (region headers, file rows, commit
  # metadata). Only the code/diff surface pins a mono role.
  code:
    fontFamily: 'inherits Archon mono token (editor/diff/hex content)'
    fontVariantNumeric: 'tabular-nums'
    fontFeatureSettings: 'inherits — ligatures off for diff legibility'
  region-header:
    role: 'inherits {typography.label} — "Changes" / "Graph" section titles'
  path-dim:
    role: 'inherits {typography.muted} — dimmed directory path on file rows'
rounded:
  # No Source-Control-specific radius delta; inherits Archon shadcn defaults for
  # panels, rows, badges, buttons.
  inherit: 'Archon shadcn rounded/sm · rounded/md · rounded/lg as-is'
spacing:
  # Inherits the Archon 4-based Tailwind scale as-is. Only fixed row heights are
  # pinned (virtualization requires stable row height — @tanstack/react-virtual).
  commit-row-height: '[ASSUMPTION] ~24px illustrative — virtualization needs a stable height; exact value TBD at build'
  file-row-height: 'inherits Archon list-row density'
  panel-split-default: '[ASSUMPTION] ~33% / ~67% starting ratio (user-resizable via react-resizable-panels); default not user-confirmed'
components:
  changes-row:
    layout: 'filename + {typography.path-dim} directory + right-aligned M/A/D badge'
    radius: '{rounded.inherit}'
    state-hover: 'inherits Archon list-row hover'
    write-affordances: 'NONE — no stage/unstage/discard/commit controls (read-only)'
  status-badge:
    kind: 'letter badge — literal M | A | D, right-aligned'
    foreground: '{colors.badge-M-fg} / {colors.badge-A-fg} / {colors.badge-D-fg}'
    rule: 'letter is the primary cue (accessible); optional tint never sole signal'
  commit-graph-row:
    layout: 'lane column (branch/merge topology dots + lines) + message + author + relative time'
    render: '[ASSUMPTION/recommended] reuse @xyflow/react (run screen Graph tab stack) OR a bespoke SVG (windowing spike-selected) — either needs NO new dep (verified); renderer is a build decision, not user-confirmed'
    expand: 'click expands INLINE beneath the row to that commit’s M/A/D file list'
  viewer-diff:
    kind: 'M — two-pane diff, react-diff-view'
    coloring: '{colors.diff-removed-bg} left/before · {colors.diff-added-bg} right/after'
    a11y: 'per-line +/- gutter markers ({colors.diff-*-gutter}) — non-color cue (WCAG 1.4.1)'
  viewer-single:
    kind: 'A / D — single pane, full content, NO diff coloring'
  empty-state:
    kind: 'whole-panel message — title + body (+ optional Reload CTA)'
    surface: 'replaces Changes + Graph + viewer entirely'
  reload:
    kind: 'inherits Archon button (secondary/ghost) — manual re-fetch; no auto/poll'
---

# DESIGN.md — Archon Source Control tab

The Source Control tab is a **read-only, run-scoped git inspector** rendered as the fourth tab on the workflow-run screen (beside Graph / Logs / Chat) [prd.md §4.1 FR-1]. It inherits the existing Archon web design system (React 19 + Tailwind v4 + shadcn/Radix) wholesale. This document specifies **only the visual deltas** that are Source-Control-specific and were actually decided; every token not listed inherits the Archon system as-is. No new palette, type scale, or radius is invented — where a decided visual (e.g. the diff green tint) has no existing Archon token, it is flagged in **Open Questions**, not fabricated.

## Brand & Style

The tab is a diagnostic instrument, not a destination. Its visual posture is **VS Code's Source Control panel, adapted for read-only** [prd.md §4.1; imports/vscode-source-control-reference.md]: a quiet master-detail surface where the content (file paths, diffs, commit topology) carries all the weight and the chrome disappears. Discipline: inherit Archon tokens for everything; add visual language only for the three things the sources actually decide colors/marks for — the M diff, the M/A/D badges, and the two-region layout.

Deliberately **absent** visual surfaces (they must never appear): a Commit button/box, inline stage/unstage/discard row actions (`+`, `↩`, `-`), an Explorer tree of unchanged files, and the VS Code activity-bar chrome [.memlog decisions; prd.md §5 Non-Goals]. The reference screenshot shows these; Archon drops them because there is no write surface anywhere in the feature.

## Colors

The **only color decision in the entire source set** is the M diff: red = before, green = after; A/D panes are uncolored [prd.md FR-4:115-117; addendum.md §Viewer table]. Everything else inherits Archon tokens.

- **Diff removed (before)** — a _subtle_ red line background, left pane, extending `{colors.destructive}` at low opacity (a line tint, not a destructive fill), plus a `-` gutter marker in `{colors.diff-removed-gutter}`. The tint is `[ASSUMPTION — default conventional]`; the `-` marker is the confirmed cue.
- **Diff added (after)** — a subtle green line background, right pane; shadcn has **no default green semantic token**, so `{colors.diff-added-bg}` is an explicit extension bound to the Archon palette (or react-diff-view's theme) at build — see Open Questions. Plus a `+` gutter marker. The tint is `[ASSUMPTION]`; the `+` marker is the confirmed cue.
- **Accessibility (WCAG 1.4.1) — LOCKED floor:** the diff MUST NOT rely on color alone; the per-line **`+` / `-` gutter marker is the confirmed, non-color cue** (GitHub/unified-diff convention, supported by react-diff-view). The red/green line tint is `[ASSUMPTION — default conventional treatment, NOT explicitly chosen by the user]` — "ok" did not disambiguate "markers only" vs "markers + tint"; promote the tint to a decision only on explicit selection. The markers stand regardless [.memlog a11y: markers LOCKED, tint ASSUMPTION].
- **M/A/D badges** carry meaning by **letter**, never by color alone — accessible by construction. Any tint is decorative reinforcement only [.memlog badge decision].
- **A and D viewer panes are uncolored** — plain inherited `{colors.foreground}` on `{colors.background}`; no red/green [prd.md FR-4:116-117].
- **Contrast targets (load-bearing):** the `+`/`-` diff gutter markers — the sole WCAG-1.4.1 cue — MUST meet **≥ 4.5:1** against their line background on both the tinted and untinted diff surface (a build-acceptance check, since `{colors.diff-*-gutter}` / `{colors.diff-*-bg}` bind at build) [A11Y-1]. Commit-graph lane dots/lines convey topology and MUST meet **≥ 3:1** non-text contrast — attach to the graph renderer spike [A11Y-3]. M/A/D badge letters and the dimmed `{typography.path-dim}` path MUST be **verified** to meet AA text contrast against their inherited background — not assumed from inheritance.

Avoid: coloring A/D content, using `{colors.destructive}` at full strength for diff lines, or making badge meaning color-dependent.

## Typography

Chrome (region headers, file rows, commit message/author/time, breadcrumb) inherits the Archon sans ramp. The **code/diff/hex content surface** pins the inherited Archon **mono** role with `tabular-nums` so diff line numbers and hex offsets align. Tokenization/highlighting is `highlight.js` (already installed — no Shiki) [architecture.md D3:35]. Dimmed directory paths on file rows use `{typography.path-dim}` (inherited muted) to keep the filename dominant.

## Layout & Spacing

**Master-detail, two-column** (Layout V1, Kevin-confirmed against the VS Code reference) [.memlog decision "LAYOUT V1"]:

- **LEFT — "Source Control" panel.** Two stacked regions, **both visible** — a **Changes** region (uncommitted "Now" files) _above_ a **Graph** region (the run branch's commit topology) [prd.md FR-1:71-74; addendum.md §Viewer]. Whether each region scrolls **independently** vs one panel scroll is an `[ASSUMPTION]` (not user-confirmed).
- **RIGHT — editor/viewer pane.** Opens the clicked file (breadcrumb path + content or diff) [imports/vscode-source-control-reference.md].
- **Split:** `react-resizable-panels` [architecture.md D3:35] between the left panel and the right viewer, user-resizable; the split divides _left panel ↔ right viewer_ (not the diff panes). The starting ratio (~33/67) is an `[ASSUMPTION]`.

Spacing inherits the Archon 4-based Tailwind scale as-is. Row heights are **pinned for virtualization** (`@tanstack/react-virtual` needs stable heights); the specific commit-row height (~24px `[ASSUMPTION]`) and file-row density are TBD at build [graph-cost-scout.md §Perf].

## Elevation & Depth

Inherited from Archon shadcn — no elevation as a hierarchy device. The region split and the panel resize handle carry structure; no drop shadows are added on top. The right viewer reads as the same plane as the left panel, divided by the resize handle, not floated above it.

## Shapes

No Source-Control-specific radius delta — panels, file rows, badges, the Reload button, and the empty-state card all inherit Archon shadcn `rounded/*`. Status badges follow the inherited badge shape; the letter, not the shape, carries status.

## Components

Behavioral rules live in `EXPERIENCE.md`; this section is the visual spec of the Source-Control-specific parts. Standard shadcn parts (Button for Reload, Skeleton for loading, Tabs for the run-screen tab strip, resizable panels) are used **as-is**.

- **Changes row** — filename + dimmed `{typography.path-dim}` directory + right-aligned **M/A/D badge**. Inherited list-row hover. **No** write affordances (no `+`/`↩`/`-`, no checkbox) — click the row to open the file in the viewer, nothing else [.memlog "bỏ nút commit"; prd.md §5].
- **Status badge (`status-badge`)** — a letter badge showing literally `M`, `A`, or `D`, right-aligned. New/untracked files fold to **A** (untracked-U and staged-A both display A; read-only has no staging, so U-vs-A is dropped as non-actionable) [.memlog badge decision]. Letter is the accessible primary cue.
- **Commit-graph row (`commit-graph-row`)** — a **lane column** (branch/merge topology dots + connecting lines) + commit message + author + relative time. Renderer is an `[ASSUMPTION/recommended]`: reuse the already-installed **`@xyflow/react`** (run screen Graph tab stack) or a **bespoke SVG** — either needs **no new dependency** (verified) [graph-cost-scout.md]. A row **expands inline** to reveal that commit's M/A/D file list beneath it — confirmed [.memlog LOCKED].
- **Viewer — diff (`viewer-diff`, M only)** — two-pane `react-diff-view`: left/before in `{colors.diff-removed-bg}`, right/after in `{colors.diff-added-bg}`, each line prefixed by its `+`/`-` gutter marker. Header shows the file tab + breadcrumb path.
- **Viewer — single pane (`viewer-single`, A / D)** — one pane, full file content, **no diff coloring** [prd.md FR-4].
- **Empty state (`empty-state`)** — a whole-panel message (title + body, optional Reload CTA) that **replaces** the Changes + Graph + viewer entirely. Inherited card/typography; centered. Two distinct copies (container vs no-readable-checkout) — see `EXPERIENCE.md` State Patterns.
- **Reload (`reload`)** — an inherited shadcn button; manual re-fetch of the current region/file. No "Auto" toggle, no polling indicator [prd.md FR-2].

## Do's and Don'ts

| Do                                                                                                        | Don't                                                                   |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Inherit every Archon token not in the delta list                                                          | Invent a new palette, type scale, or radius                             |
| Carry M/A/D meaning by the **letter**                                                                     | Make badge status depend on color                                       |
| Give the M diff a `+`/`-` gutter marker as the primary cue                                                | Rely on red/green line tint alone (fails WCAG 1.4.1)                    |
| Keep A/D panes uncolored                                                                                  | Apply red/green to added/deleted single-pane content                    |
| Show a quiet read-only surface (click to view)                                                            | Render a Commit button, stage/discard actions, or an Explorer tree      |
| Render the commit lane graph with `@xyflow/react` reuse **or** a bespoke SVG (spike-selected; no new dep) | Add a new graph/diff dependency (only `react-diff-view` is new, per D3) |
| Bind the diff green tint to an Archon palette value at build                                              | Ship a fabricated green hex in this doc                                 |
