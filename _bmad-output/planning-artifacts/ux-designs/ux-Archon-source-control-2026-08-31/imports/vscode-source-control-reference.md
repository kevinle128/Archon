# User-supplied visual — VS Code Source Control (layout reference)

**Provided by:** Kevin, in chat ("tôi muốn như này"), as a screenshot of VS Code's Source Control view.
**Note:** the raw image was pasted in the conversation; its binary is not extractable to disk from here, so this file records what it shows for the audit trail.

## What the image VISIBLY establishes

- **Left panel = VS Code "Source Control"**, two stacked sections, both visible (scroll):
  - **Changes** (header, count 14) — a list of changed files; each row: filename, dimmed directory path, a right-aligned status letter (image shows `M` and `U`), a `!` icon on some rows. A "Commit" button sits above the list.
  - **Graph** — commit history rendered as a **graph** (coloured branch/merge topology column), each row = a commit with author ("Kevin Le") and, on the current one, relative time. The **current/HEAD commit is shown expanded**, listing its own changed files (each with a status letter). Below: a series of `update` commits and `Merge pull request #45/#44/#43…` rows.
- **Right = editor pane** showing the opened file `archon-validate-pr.yaml` (tab with `M` + close), a breadcrumb path (`.archon > workflows > defaults > archon-validate-pr.yaml`), line numbers, and YAML content.
- Far-left VS Code activity bar (Explorer/Search/SCM/Run/Extensions…) — **VS Code chrome, not part of the Archon tab.**

## Inferred (NOT proven by a static image — pending Kevin confirmation)

- That a commit **expands/collapses on click** (image shows one expanded state only).
- The exact **return-to-"Now"** interaction.
- **Read-only adaptations** for Archon: dropping the Commit button + inline stage/unstage/discard actions; badge set M/A/D vs the image's `U`; refresh = manual Reload.

## Decision it drives

- Confirms **Layout V1** (master-detail: left SCM panel + right editor pane) as the target for the Archon Source Control tab.
