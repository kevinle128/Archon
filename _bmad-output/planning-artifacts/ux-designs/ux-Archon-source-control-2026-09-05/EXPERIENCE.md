---
status: final
created: 2026-09-05
updated: 2026-09-05
design: ./DESIGN.md
sources:
  - ../../../specs/spec-archon-source-control/SPEC.md
  - ../../../specs/spec-archon-source-control/viewer-rules.md
  - ../../../specs/spec-archon-source-control/brownfield.md
  - ../../../specs/spec-archon-source-control/architecture-diagrams.md
  - ../../../specs/spec-archon-source-control/roadmap.md
---

# EXPERIENCE.md — Archon Source Control (legacy UI)

How the Source Control tab **works**: information architecture, states, interactions, accessibility, and the operator's key flows. Visual identity lives in `DESIGN.md`; this spine cross-references its tokens by `{path.to.token}`. Every load-bearing behavior cites the source that originates it. Unresolved items are collected in **Open Questions & Assumptions** — they are not silently invented.

## Foundation

A read-only, run-scoped git inspector — a fourth tab, **Source Control**, on the legacy workflow-run screen (`/legacy/workflows/runs/:id`) beside Graph / Logs / Chat [SPEC CAP-1]. It answers one question for the run being viewed: _"did this run change the files I think it did?"_ [SPEC Why].

- **Stakes:** internal tool, single trusted operator, run-level visibility; ship without a feature flag [SPEC].
- **Read-only is a hard guardrail:** no write/commit/edit/stage/discard surface anywhere [SPEC CAP-5]. The UI never sends a path — only `runId` + file/commit refs; path resolution is server-side [SPEC; brownfield].
- **UI system:** Archon web design system (React 19 + Tailwind v4 + shadcn/Radix). Both spines inherit it; this file specifies only behavioral deltas.
- **Form-factor:** desktop web first; mobile layout is not a v1 target [ASSUMPTION — SPEC silent].
- **Performance contract:** fetch-on-click with explicit loading feedback; the tab must never block or regress the run screen [SPEC Constraints].

## Information Architecture

Master-detail, two columns inside the run screen's existing resizable panel group. The left panel stacks two regions, **both visible** — Changes above History; the right pane is the shared viewer [SPEC CAP-1; architecture-diagrams].

| Region      | Location                  | Scope                | Content                                                                                                         | Source                                 |
| ----------- | ------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Changes** | Left panel, top           | Uncommitted "Now"    | The run checkout's uncommitted changed paths, each badged `M`/`A`/`D`                                           | SPEC CAP-2                             |
| **History** | Left panel, below Changes | The run's own branch | Commits most-recent-first (incl. commits not on the base branch); a row expands inline to its `M`/`A`/`D` files | SPEC CAP-4; inline-expand [ASSUMPTION] |
| **Viewer**  | Right pane                | Whatever was clicked | One shared, status-keyed file view (diff for `M`; single pane for `A`/`D`)                                      | SPEC CAP-3                             |

- **One list widget, one viewer.** Both regions feed the same file-row pattern and the same viewer; only the read scope differs [architecture-diagrams].
- **Key-screen mock:** [`mockups/key-screen-source-control-2026-09-05.html`](./mockups/key-screen-source-control-2026-09-05.html) — populated state with an `M` two-pane diff open, 30/70 split, independently scrolling panes. **The spines win on any conflict** with the mock.
- **Only changed files appear** — no tree of unchanged files [SPEC Non-goals].
- **Return to "Now":** the Changes region stays pinned at the top of the left panel; leaving a commit means scrolling back up — no breadcrumb control [ASSUMPTION].
- **Status set is exactly `M`/`A`/`D`.** Projections: untracked → `A`; rename → `D`(old)+`A`(new); copy → `A`; type-change → `M`; unmerged → `M` [viewer-rules].
- **History default scope:** the worktree's current branch, most-recent-first, lazy "Load more" [ASSUMPTION — roadmap leaves run-commits-vs-full-history undecided].

## Voice and Tone

Microcopy is terse, factual, and non-alarming — a diagnostic reporting a fact, never an error shouting. Empty and absence states explain _why the data isn't here_ in one plain sentence and stop.

| Do                                                                                                                 | Don't                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| "No files to show"                                                                                                 | "Error: working tree not found ⚠️"                                                         |
| "This run executed inside a container — its working files aren't on the host to read." [ASSUMPTION copy]           | "Container runs are unsupported."                                                          |
| "This run's checkout isn't available — it may not be ready yet, or it may have been cleaned up." [ASSUMPTION copy] | "The run has no git worktree." _(misleading — folder/`--no-worktree` runs still have one)_ |
| "Changed on disk — Reload"                                                                                         | auto-refresh the view under the reader                                                     |
| Badge a file `M` / `A` / `D`                                                                                       | invent extra statuses or color-only cues                                                   |

## Component Patterns

Behavioral rules; visual specs live in `DESIGN.md.Components`.

| Component       | Use                 | Behavioral rules                                                                                                                                     | Source                            |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Changes row     | Changes region      | Click the row → opens that file in the shared viewer. **No** other affordance (no stage/discard/checkbox). Right-aligned badge.                      | SPEC CAP-2/5                      |
| Status badge    | Both regions        | Displays literally `M`/`A`/`D`; the letter is the accessible cue.                                                                                    | SPEC CAP-2                        |
| Commit row      | History region      | Click → its changed files **expand inline** beneath it (each an openable file row); click again to collapse. Shows message + author + relative time. | SPEC CAP-4; [OQ-2]                |
| Viewer — diff   | Right pane, `M`     | Two-pane red/green, `HEAD→worktree` (Now) or `parent→commit` (history). `+`/`-` gutter markers per line.                                             | viewer-rules                      |
| Viewer — single | Right pane, `A`/`D` | One pane, full content, no coloring. `A` = new content; `D` = removed content.                                                                       | viewer-rules                      |
| Reload          | Panel chrome        | Manual re-fetch of the current region/file; never auto/poll.                                                                                         | SPEC                              |
| Empty state     | Whole tab           | Replaces both regions + viewer; title + one-line body; Reload CTA **only when a retry could help**.                                                  | SPEC CAP-6; CTA rule [ASSUMPTION] |
| Load more       | Viewer              | Large text streams in chunks — first paint ~256 KB / ~2,000 lines; `M` gets hunks + 3 lines context.                                                 | viewer-rules                      |
| Cancel          | Viewer              | Aborts an in-flight load; offered on streams > ~1 MB.                                                                                                | viewer-rules                      |

## State Patterns

| State                        | Trigger                                                                                                                         | Treatment                                                                                                 | Source                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Populated                    | Host git checkout exists at read time                                                                                           | Changes + History + viewer                                                                                | SPEC CAP-1                        |
| Empty Changes                | No uncommitted files (auto-commit / no-HITL runs)                                                                               | Changes region shows "No uncommitted changes" [ASSUMPTION copy]; History stays visible                    | SPEC; roadmap COULD               |
| Empty — container run        | Container-backend run (out of v1 — host path stale mid-run)                                                                     | Whole-tab empty state; **no Reload CTA** (files aren't on the host)                                       | SPEC CAP-6; CTA rule [ASSUMPTION] |
| Empty — no readable checkout | `working_path` null / directory absent / not a git checkout — decided by **directory existence at read time, never run status** | Whole-tab empty state **with Reload CTA** (a running run's checkout may not be ready yet — transient)     | SPEC CAP-6; CTA rule [ASSUMPTION] |
| Loading (viewer)             | File clicked, bytes arriving                                                                                                    | List + file sizes render from metadata immediately; the viewer paints a **skeleton** with **Cancel**      | viewer-rules                      |
| Stale content                | Host changed since load                                                                                                         | "Changed on disk — Reload" affordance; **never mutate the open view** under the reader                    | viewer-rules                      |
| Large text                   | > ~256 KB / ~2,000 lines                                                                                                        | Chunked stream + "Load more"                                                                              | viewer-rules                      |
| Very large                   | > ~50 MB                                                                                                                        | Download-only fallback                                                                                    | viewer-rules                      |
| Binary                       | NUL in first 8 KB                                                                                                               | Images (png/jpg/gif/webp/svg) render inline; others offer download + hex peek of first ~4 KB              | viewer-rules                      |
| Worktree gone mid-view       | Cleanup while the tab is open (conversation/PR close, scheduler merged-6h / stale-14d, manual, codebase delete, orphan)         | Next read re-detects by directory existence → the CAP-6 empty state, never a crash                        | brownfield                        |
| Loading (panel)              | Tab opened or Reload clicked; Changes / History fetches in flight                                                               | Changes + History show skeleton rows (shadcn skeleton); viewer stays empty until a file is clicked        | Foundation fetch-on-click         |
| Empty History                | No commits yet on the run branch                                                                                                | History region shows "No commits yet" [ASSUMPTION copy]; Changes stays visible                            | [ASSUMPTION]                      |
| API error                    | Checkout exists, but a git/API read fails (timeout, 5xx, git not found, permission denied) — **not** a CAP-6 missing-checkout   | Inline error in the failing region + Reload CTA; other regions stay as they were; never a whole-tab crash | [ASSUMPTION] treatment            |

## Interaction Primitives

- **Click** a file row → open in the viewer. **Click** a commit row → expand/collapse its files. **Click** Reload → re-fetch the current scope. Those are all the clicks; there is no fourth action [SPEC read-only].
- **Keyboard:** full operability via native focus (Tab / Enter); arrow-key list navigation [ASSUMPTION — nice-to-have, not SPEC-mandated].
- **No auto-refresh, ever.** The view is a snapshot the reader owns until they choose Reload [viewer-rules].

## Accessibility Floor

- Status is letter-carried (`M`/`A`/`D` text), never color-only; diffs carry `+`/`-` gutter markers, never tint-only [SPEC; viewer-rules].
- Every interactive row is focusable and activates on Enter/Space; focus moves to the viewer header when content swaps [ASSUMPTION].
- Skeletons announce via `aria-live="polite"`; Cancel is keyboard-reachable [ASSUMPTION].
- Contrast inherits the Archon dark theme; diff tints sit under text that keeps the base foreground [ASSUMPTION].

## Key Flows

### Flow 1 — "Did it touch what I think?" (primary)

**Tú, solo operator, runs a nightly refactor workflow on his home server; he reviews from a café laptop with no repo clone.**

1. Tú opens the finished run at `/legacy/workflows/runs/:id` and clicks the **Source Control** tab.
2. The Changes region lists three files, badged `M` `M` `A` — exactly the three the workflow was meant to touch.
3. He clicks the first `M`; the viewer paints a skeleton, then a two-pane diff — red before, green after.
4. He scans the hunks, then clicks the `A`; a single neutral pane shows the new file's full content.
5. He expands the top commit in History to confirm what already landed; its files fold open beneath the commit row.
6. **Climax:** the quiet nod — _"yes, exactly those files, nothing else."_ He closes the tab and approves the PR. The whole inspection took under a minute and never left the run screen.
7. **Failure path:** if a diff fetch fails (timeout / 5xx / git error), the viewer shows an inline error with a Reload CTA; the file list stays visible and other files stay selectable.

### Flow 2 — The vanishing checkout

**Tú reopens a two-week-old run to check what it changed.**

1. The Source Control tab reads the run; the checkout was reaped by the stale-14d scheduler.
2. The whole tab shows the empty state: "This run's checkout isn't available — it may have been cleaned up." [ASSUMPTION copy]
3. No error, no endless spinner. (Post-v1, CAP-8 serves the same UI from the durable snapshot — this empty state is where that fallback will surface.) [roadmap]

### Flow 3 — Opening a large or binary file

**Tú opens a generated fixture the workflow wrote — a 10 MB TypeScript dump — then a PNG the agent committed.**

1. He clicks the 10 MB `A` file. The list paints immediately (name + size from metadata); the viewer shows a skeleton and a **Cancel** button.
2. The first ~256 KB / ~2,000 lines stream in. He scrolls, then clicks **Load more**; another chunk appends.
3. He hits Cancel on a second, slower file — the skeleton clears; the list stays; nothing else is mutated.
4. A 60 MB dump offers **Download** only — no inline stream.
5. He opens a PNG; it renders inline. A `.wasm` shows a hex peek of the first ~4 KB plus Download.
6. **Climax:** every file opened or offered a usable fallback. No spinner forever. No "file too large" dead-end.

## Responsive & Platform

Desktop web first; the legacy run screen is a desktop surface. The two-pane diff never overflows the viewer: each side scrolls horizontally on its own so a long line cannot clip the opposite pane or the window edge. Below 900px the tab collapses to a single column — lists above, viewer below — and the two diff sides stack (before over after) [ASSUMPTION — SPEC silent; v1 puts no effort into a dedicated mobile layout]. Illustrated by [`mockups/key-screen-source-control-2026-09-05.html`](./mockups/key-screen-source-control-2026-09-05.html).

## Open Questions & Assumptions

| #   | Item                                                                        | Status                                                                   |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Form-factor: desktop-first, mobile out of v1                                | [ASSUMPTION]                                                             |
| 2   | Commit row interaction: inline expand/collapse                              | [ASSUMPTION]                                                             |
| 3   | History default scope: current branch, recent-first, Load more              | [ASSUMPTION] — roadmap leaves run-commits-vs-full open                   |
| 4   | CAP-6 exact copy (container vs no-checkout variants)                        | [ASSUMPTION] drafted in Voice and Tone                                   |
| 5   | Empty Changes copy + whether the region collapses                           | [ASSUMPTION] copy; collapse deferred (roadmap COULD)                     |
| 6   | Reload CTA present only when a retry could help                             | [ASSUMPTION]                                                             |
| 7   | Badge hue mapping `M`→amber / `A`→green / `D`→red                           | [ASSUMPTION]                                                             |
| 8   | Diff tint alphas bind at build from success/error (~14–20%, mock uses 14%)  | [ASSUMPTION]                                                             |
| 9   | Viewer thresholds (~256 KB / 2k lines / 1 MB / 50 MB / 8 KB NUL / 4 KB hex) | SPEC defaults, tunable at build — confirm at implementation              |
| 10  | HITL reuse of the viewer                                                    | roadmap COULD — build the viewer as reusable; don't weld it into the tab |
