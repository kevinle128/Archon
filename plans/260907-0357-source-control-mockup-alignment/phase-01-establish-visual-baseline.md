---
title: 'Phase 1: Establish Visual Baseline and Contract'
status: completed
priority: P1
effort: 3h
dependencies: []
---

# Phase 1: Establish Visual Baseline and Contract

<!-- Updated: Validation Session 1 - corrected the Source Control owner path and limited adjacent defects to follow-up findings. -->

## Overview

Reproduce the current legacy Source Control screen through the same `bun run dev` path that the user uses.
Build a visual traceability matrix before product code changes.

## Requirements

- [x] Use the restored mockup and its design documents as the visual authority.
- [x] Use the later Source Control epics and tests as the functional authority.
- [x] Preserve the commit lane graph, commit viewer, Close and Escape behavior, virtualization, large-file loading, binary fallbacks, and frozen Reload behavior.
- [x] Limit the target to `/legacy/workflows/runs/:id` and the Source Control tab.
- [x] Make no product code changes in this phase.

## Related Files

- Read `_bmad-output/planning-artifacts/ux-designs/ux-Archon-source-control-2026-09-05/DESIGN.md`.
- Read `_bmad-output/planning-artifacts/ux-designs/ux-Archon-source-control-2026-09-05/EXPERIENCE.md`.
- Read `_bmad-output/planning-artifacts/ux-designs/ux-Archon-source-control-2026-09-05/mockups/key-screen-source-control-2026-09-05.html`.
- Read `_bmad-output/planning-artifacts/epics-source-control/epics.md`.
- Read `docs/superpowers/ralph/2026-09-06-source-control-every-changed-file/prd.md`.
- Read `docs/superpowers/ralph/2026-09-07-source-control-commit-viewer/prd.md`.
- Compare `packages/web/src/components/workflows/source-control/`.
- Compare `packages/web/src/components/workflows/source-control/source-control-tab.tsx`.

## Implementation Steps

1. Run `bun install --frozen-lockfile` if the current install cannot resolve locked Web dependencies.
2. Reuse the existing `bun run dev` process when it belongs to this worktree.
3. Open the Vite Web UI at `http://localhost:5173`, not the API server at port `3090`.
4. Select or create a real git-backed workflow run with modified, added, and deleted files plus commit history.
5. Capture desktop evidence near 1440 pixels and responsive evidence at 900 and 899 pixels.
6. Record each mismatch for layout, spacing, typography, colors, actions, loading, empty, error, stale, large-file, binary, and commit states.
7. Map each mismatch to one owning component and one acceptance check.
8. Record defects outside the Source Control tab as separate follow-up findings without changing this plan's scope.

## Todo

- [x] Confirm the development dependency tree is usable.
- [x] Confirm the correct development URL.
- [x] Capture the current visual baseline.
- [x] Complete the visual and behavior traceability matrix.

## Success Criteria

- [x] The evidence covers every state listed in this phase.
- [x] The matrix separates visual changes from protected functional behavior.
- [x] No duplicate development process or alternate port is created.
- [x] No server, API, database, or workflow contract change is proposed.

## Risks and Controls

- A run may not contain all required states.
- Use a real temporary git-backed run or an existing deterministic integration fixture, and do not add fake product behavior.

## Implementation Report — 2026-09-07

### Baseline evidence

- Dev stack reused: existing `bun run dev` (API `3090` + Vite `5173`, both HTTP 200). No new process or port created.
- Fixture run: `3b392d9590846072a1b8b58a1f990287` (cancelled `superpower-feature` run) with real M/A/D changes created in its existing worktree (`thread-bce1127a`): `README.md` modified, `SECURITY.md` deleted, `baseline-probe-added.txt` added. Commit history served by `/git/log`.
- Captured: populated tab at 1440px, two-pane diff open at 1440px, boundary at 900px (stays split), stacked at 899px (lists above viewer, diff panes stack). Current stacking mechanism already works.

### Traceability matrix (mismatch → owning component → acceptance check)

| #   | Mismatch (current → design)                                                                                                             | Owner                                                               | Acceptance check                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `container`/`no_checkout` empty states render inside the left panel only; copy drift ("No worktree available", "or readable right now") | `source-control-tab.tsx` (root) + `source-control-panel.tsx` (slim) | Whole-tab state replaces the split and centers across the full tab; title "No files to show"; design body copy; Reload CTA only for `no_checkout` |
| 2   | Changes and History both `flex-1` (50/50 split)                                                                                         | `source-control-panel.tsx`                                          | Changes shrinks to content; History owns remaining left-panel height                                                                              |
| 3   | Region headers `text-sm font-medium` + `border-b`; Changes header carries a Reload link                                                 | `source-control-panel.tsx`                                          | Small uppercase tertiary headers (`0.6875rem`/600/tracking/`text-text-tertiary`), no border, no header Reload                                     |
| 4   | File rows rounded/inset, `text-xs`, mono path, neutral badge                                                                            | `changed-file-row.tsx`, `changed-files-list.tsx`                    | Full-width flat rows, 2rem height, `0.8125rem` sans path, `bg-muted` badge with warning/success/error letter                                      |
| 5   | Selected row has no visual highlight                                                                                                    | `changed-file-row.tsx`                                              | Selected row shows `surface-hover` background                                                                                                     |
| 6   | Commit rows: `text-xs` grid with separate author/time/oid columns                                                                       | `commit-graph-row.tsx`                                              | Subject `0.8125rem`; right meta `0.75rem` secondary "author · time"; lane graph retained; hover/focus intact                                      |
| 7   | Viewer header: sans `text-sm` path, text-link actions, no badge, no persistent Reload                                                   | `file-viewer.tsx`                                                   | 2.5rem header, mono `0.75rem` secondary path, status badge chip, quiet ghost Reload, retained Close; header always rendered                       |
| 8   | Stale notice is a button inside the Changes region                                                                                      | `source-control-tab.tsx` + `file-viewer.tsx`                        | Stale banner in viewer chrome (warning 10% wash, ghost sm Reload); atomic accept logic unchanged                                                  |
| 9   | Idle prompt top-left "Select a file to inspect"                                                                                         | `file-viewer.tsx`                                                   | Centered "Select a file to view", `0.8125rem` tertiary                                                                                            |
| 10  | Viewer loading = 2 pulse bars, Cancel in header                                                                                         | `file-viewer.tsx`                                                   | Skeleton rows + centered Cancel; `aria-live="polite"`                                                                                             |
| 11  | "Load more" in viewer header                                                                                                            | `file-viewer.tsx`                                                   | Load more at the file-stream boundary (footer); Cancel there while paging                                                                         |
| 12  | Diff bg `surface-inset`, 18% tints, `text-primary` markers                                                                              | `source-control-diff.css`, `virtualized-diff.tsx`                   | `surface` bg, 14% tints over transparent, `-`/`+` markers full-strength error/success                                                             |
| 13  | Panel loading shows text lines                                                                                                          | `source-control-panel.tsx`                                          | Skeleton rows per EXPERIENCE state patterns                                                                                                       |
| 14  | Region empty copy `px-4 py-3 text-sm text-secondary`                                                                                    | `source-control-panel.tsx`                                          | `0.8125rem` tertiary, `2px 12px 8px` padding                                                                                                      |
| 15  | Resize handle is the shared default                                                                                                     | `source-control-split.tsx`                                          | Local 7px hit area, 1px line, centered 5×28 grip, hover/drag brighten; shared `ui/resizable` untouched                                            |
| 16  | Viewer has no `surface` background                                                                                                      | `file-viewer.tsx`                                                   | Viewer region on `bg-surface`                                                                                                                     |
| 17  | Binary/hex/image/download panes unaligned padding/type                                                                                  | `file-viewer.tsx`                                                   | Note `0.75rem` tertiary, hex mono `0.75rem`, actions block per mockup                                                                             |
| 18  | Visible "Before"/"After" pane labels not in mockup                                                                                      | `virtualized-diff.tsx`                                              | No visible pane labels; `aria-label` on scroll regions retained                                                                                   |

### Adjacent defects (recorded, out of scope)

- None observed during baseline capture.

### Functional behaviors confirmed present (protected)

Lane graph with merge diamonds; expanded commit file viewer; frozen snapshots with stale accept; Close + Escape; virtualization (changes, history, diff hunks); large-file Load more with cursor paging; binary hex peek; inline image; Download; 900/899 stacking boundary.
