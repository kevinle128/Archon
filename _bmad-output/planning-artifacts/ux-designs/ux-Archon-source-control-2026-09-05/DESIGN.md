---
status: final
created: 2026-09-05
updated: 2026-09-05
name: Archon Source Control — legacy UI
description: Visual identity for the read-only, run-scoped Source Control tab on the legacy Archon workflow-run screen — deltas over the inherited Archon web design system.
inherits: Archon web design system (React 19 + Tailwind v4 + shadcn/Radix; dark-only theme — packages/web/src/index.css)
sources:
  - ../../../specs/spec-archon-source-control/SPEC.md
  - ../../../specs/spec-archon-source-control/viewer-rules.md
  - ../../../specs/spec-archon-source-control/brownfield.md
  - ../../../specs/spec-archon-source-control/architecture-diagrams.md
  - ../../../specs/spec-archon-source-control/roadmap.md
colors:
  # Deltas ONLY — everything not listed inherits the Archon dark theme:
  # background, foreground, card, popover, primary, secondary, muted, accent,
  # destructive, border, input, ring, surface, surface-elevated, surface-inset,
  # surface-hover, text-primary/secondary/tertiary, success, warning, error.
  # Diff line tints are subtle backgrounds — NEVER full-strength error/success.
  # Exact alphas bind at build from the Archon palette (react-diff-view theme);
  # values below are semantic references, not fabricated hex. Expected ~14–20%
  # alpha (mock uses color-mix 14%) — adjust for WCAG contrast against
  # {colors.text-primary}. [ASSUMPTION: bind at build]
  diff-removed-bg: 'extends {colors.error} — ~14% alpha red line tint (before)'
  diff-added-bg: 'extends {colors.success} — ~14% alpha green line tint (after)'
  diff-removed-gutter: '{colors.error} full strength — the `-` marker'
  diff-added-gutter: '{colors.success} full strength — the `+` marker'
  badge-m-fg: '{colors.warning} — git-conventional amber; letter-carried, color is enhancement only [ASSUMPTION]'
  badge-a-fg: '{colors.success} — letter-carried [ASSUMPTION]'
  badge-d-fg: '{colors.error} — letter-carried [ASSUMPTION]'
  badge-bg: '{colors.muted} — one neutral chip for all three statuses'
typography:
  # Chrome inherits the Archon sans ramp (Inter). Only content pins mono.
  code:
    fontFamily: 'JetBrains Mono — the Archon mono token (diff / file / hex content)'
    fontVariantNumeric: 'tabular-nums'
    fontFeatureSettings: 'ligatures off — diff legibility [ASSUMPTION]'
  region-header:
    note: 'shadcn small / uppercase-tracking convention [ASSUMPTION]'
    fontWeight: '600'
  file-row:
    note: '0.8125rem class — matches the chat-markdown table density [ASSUMPTION]'
  commit-meta:
    note: '0.75rem / text-xs, {colors.text-secondary} — author + relative time [ASSUMPTION]'
rounded:
  # Inherits the Archon scale (--radius: 0.625rem → sm/md/lg/xl). No new radii.
spacing:
  # Named deltas only; the numeric scale inherits Tailwind.
  panel-split-default: '30% left / 70% right — user-resizable via the screen’s existing ResizablePanelGroup (narrowed from 40/60 in review)'
  row-height: '2rem — file & commit rows [ASSUMPTION]'
  region-padding: 'inherits — matches the run screen’s existing panel padding'
components:
  changes-row:
    bg: 'transparent; hover {colors.surface-hover}'
    fg: '{colors.text-primary}'
    badge: 'right-aligned {components.status-badge}'
  status-badge:
    bg: '{colors.badge-bg}'
    fg: '{colors.badge-m-fg} | {colors.badge-a-fg} | {colors.badge-d-fg} by status'
    radius: '{rounded.sm}'
    note: 'the M/A/D letter is the cue; color never stands alone'
  commit-row:
    bg: 'transparent; hover {colors.surface-hover}'
    fg: '{colors.text-primary} message; {colors.text-secondary} meta'
  viewer-diff:
    bg: '{colors.surface} — matches the .hljs background'
    added-line: '{colors.diff-added-bg}'
    removed-line: '{colors.diff-removed-bg}'
    gutter: '{colors.diff-added-gutter} / {colors.diff-removed-gutter}'
    font: '{typography.code}'
  viewer-single:
    bg: '{colors.surface}'
    font: '{typography.code}'
    note: 'no status coloring — neutral content pane for A and D'
  empty-state:
    fg: '{colors.text-secondary}; title {colors.text-primary}'
    note: 'centered across the whole tab region; replaces panel + viewer'
  reload:
    note: 'shadcn ghost icon button in the panel chrome — inherits'
  load-more:
    bg: 'transparent'
    fg: '{colors.text-secondary}'
    note: 'inline text button at the stream boundary (bottom of the viewer), not sticky; shadcn ghost'
  cancel:
    bg: 'transparent'
    fg: '{colors.text-primary}'
    note: 'shadcn ghost, sits on the viewer skeleton chrome next to the pulsing bars; keyboard-reachable'
---

# DESIGN.md — Archon Source Control (legacy UI)

How the Source Control tab **looks**. Behavior lives in `EXPERIENCE.md`, which cross-references these tokens by `{path.to.token}`. This spine and `EXPERIENCE.md` win on conflict with any mock, wireframe, or import.

## Brand & Style

A diagnostic instrument, not an IDE. The tab reports what the run did — quietly, densely, factually — the way a good log line does. It inherits Archon's dark, focused aesthetic whole: deep blue-grey surfaces, restrained chroma, content-first. Nothing on this tab celebrates; nothing alarms. The strongest colors on screen belong to the diff itself, and even they are tints, not shouts.

## Colors

- **Diff tints** (`{colors.diff-added-bg}`, `{colors.diff-removed-bg}`) — the only new chromatic surfaces. Low-alpha washes of the existing `{colors.success}` / `{colors.error}` so a 200-line diff stays readable; full-strength hues live only in the `+`/`-` gutter markers. Red always means _before_, green always means _after_ — the tab never inverts the reader's diff muscle memory.
- **Status badges** (`{colors.badge-m-fg}` / `{colors.badge-a-fg}` / `{colors.badge-d-fg}`) — git-conventional amber/green/red on one neutral `{colors.muted}` chip. The letter carries the meaning; the hue is a courtesy. [ASSUMPTION: hue mapping — user to confirm]
- Everything else — headers, rows, borders, focus rings — inherits the Archon theme untouched.

## Typography

Two voices. Chrome (region headers, file names, commit metadata) speaks the inherited Inter ramp. Content (diffs, file bodies, hex peeks) speaks JetBrains Mono with `tabular-nums` and ligatures off — alignment and character fidelity matter more than fluency there. [ASSUMPTION: ligatures-off]

## Layout & Spacing

The tab fills the existing workflow-run content area as a master-detail pair inside the screen's already-installed `ResizablePanelGroup`: left panel (Changes over History) at a 30/70 default split — the panel is for scanning, the viewer for reading, so the reader gets the room — user-resizable from there. Rows are dense — 2rem [ASSUMPTION] — because the operator is scanning, not reading. No new spacing scale; panel padding matches the screen's other tabs.

Key-screen mock (spines win on conflict): [`mockups/key-screen-source-control-2026-09-05.html`](./mockups/key-screen-source-control-2026-09-05.html) — populated state with an `M` two-pane diff open, 30/70 split, independently scrolling panes, 900px collapse.

## Elevation & Depth

Inherits. The viewer sits on `{colors.surface}` (the same surface highlight.js already uses); panels sit on the base background. No shadows, no new layers.

## Shapes

Inherits the Archon radius scale (`--radius: 0.625rem`). The only shaped element is the status badge at `{rounded.sm}`.

## Components

Visual anatomy per component lives in the frontmatter `components:` map; behavioral rules live in `EXPERIENCE.md.Component Patterns`.

## Do's and Don'ts

| Do                                                     | Don't                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| Keep diff tints subtle — alpha washes of success/error | Use full-strength `destructive`/`success` as line backgrounds  |
| Carry status in the letter `M`/`A`/`D`                 | Color-only status cues                                         |
| Mono for content, sans for chrome                      | Mono region headers or file rows                               |
| One neutral badge chip for all statuses                | Per-status badge backgrounds                                   |
| Show the read-only truth                               | Any affordance that looks like commit / stage / edit / discard |
