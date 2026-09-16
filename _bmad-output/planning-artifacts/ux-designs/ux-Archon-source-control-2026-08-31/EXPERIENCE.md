---
status: final
created: 2026-09-01
updated: 2026-09-01
design: ./DESIGN.md
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
---

# EXPERIENCE.md — Archon Source Control tab

How the Source Control tab **works**: information architecture, states, interactions, accessibility, and the operator's key flow. Visual identity lives in `DESIGN.md`; this spine cross-references its tokens by `{path.to.token}`. Every load-bearing behavior cites the source that originates it. Unresolved items are collected in **Open Questions & Assumptions** — they are not silently invented.

## Foundation

A read-only, run-scoped git inspector — a fourth tab, **Source Control**, on the existing workflow-run screen beside Graph / Logs / Chat [prd.md §3 glossary; §4.1 FR-1:63-74]. It answers one question for the run being viewed: _"did this run change the files I think it did?"_ [prd.md §1]. It is deliberately **not** an embedded IDE, a generic file browser, or an Explorer tree of unchanged files [prd.md §5 Non-Goals:202-205].

- **Stakes:** internal tool, single trusted operator role, run-level visibility; no per-tab restriction; ship without a feature flag [prd.md §2.3, §9:250, §Rollout].
- **Read-only is a hard guardrail:** there is no write/commit/edit/stage/discard surface anywhere [prd.md §5:203, §Constraints:271]. The UI removes the VS Code Commit button and inline stage/unstage/discard actions the reference screenshot shows [.memlog; imports/vscode-source-control-reference.md].
- **Stack (decided, except graph renderer):** `react-diff-view` (the one new dep) + installed `highlight.js`, `react-resizable-panels`, `@tanstack/react-virtual`, `@tanstack/react-query`; the commit-graph renderer is spike-selected — reuse the already-installed `@xyflow/react` **or** a bespoke SVG (no new dep); web consumes OpenAPI-generated types only [architecture.md D3:35; graph-cost-scout.md].
- **Performance contract:** fetch-on-click with explicit loading feedback; no hard SLA; the tab must never block or regress the run screen (SM-C1) [prd.md §Cross-Cutting NFRs:262].

## Information Architecture

Master-detail, two columns. The left "Source Control" panel stacks two regions that are **both visible** (Changes above Graph); the right pane is the shared viewer. Whether each region scrolls **independently** vs one panel scroll is an `[ASSUMPTION]` (not user-confirmed). Visual geometry and the resize split are in `{spacing.panel-split-default}` / `DESIGN.md.Layout & Spacing`.

| Region                     | Location                      | Scope                | Content                                                                                                                                                    | Source                                                              |
| -------------------------- | ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Changes**                | Left panel, **top**           | Uncommitted "Now"    | The run checkout's uncommitted changed paths, each badged one of `M`/`A`/`D`                                                                               | prd.md FR-3; addendum.md §Viewer                                    |
| **Graph** (commit history) | Left panel, **below Changes** | The run's own branch | Commits on the run branch (incl. commits not merged to base), rendered as a branch/merge **topology graph**; a row expands inline to its `M`/`A`/`D` files | prd.md FR-6 §4.4; epics.md Story 2.1; .memlog "FULL TOPOLOGY GRAPH" |
| **Viewer**                 | Right pane                    | Whatever was clicked | One shared, status-keyed file view (diff for `M`; single pane for `A`/`D`)                                                                                 | prd.md FR-4; addendum.md §Viewer                                    |

- **One list widget, one viewer.** Both regions feed the same file-row pattern and the same viewer; only the read scope differs [addendum.md:37].
- **Only changed files appear** — no tree of unchanged files [prd.md §5:205].
- **Return-to-"Now":** the Changes region stays **pinned at the top** of the left panel; there is no separate Back/breadcrumb control to leave a commit — the operator scrolls back to Changes [.memlog interactions LOCKED].
- **Status set is exactly `M`/`A`/`D`.** Projections: untracked-new → `A`; rename → `D`(old)+`A`(new); copy → `A`; type-change → `M`; unmerged → `M` [prd.md FR-3:101; addendum.md:38]. New files fold to `A` (untracked-U and staged-A both display `A`; read-only has no staging) [.memlog badge decision].
- **Composition reference:** the master-detail layout is illustrated by `wireframes/flow-source-control-v1-refined-2026-08-31.excalidraw` (+ `.png`); the operator's VS Code reference is `imports/vscode-source-control-reference.md`. **The spines (`DESIGN.md` + `EXPERIENCE.md`) win on any conflict** with a wireframe, mock, or import [rubric §5].

## Voice and Tone

Microcopy is terse, factual, and non-alarming — a diagnostic reporting a fact, never an error shouting. Empty and absence states explain _why the data isn't here_ in one plain sentence and stop. Aesthetic posture is in `DESIGN.md`.

| Do                                                                                                                     | Don't                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| "No files to show"                                                                                                     | "Error: working tree not found ⚠️"                                                                                         |
| "This run executed inside a container — its working files aren't on the host to read."                                 | "Container runs are unsupported."                                                                                          |
| "This run's checkout isn't available or readable right now — it may not be ready yet, or it may have been cleaned up." | "The run has no git worktree." _(misleading — folder/`--no-worktree` runs still have a `working_path`)_ [.memlog copy-fix] |
| "changed — Reload"                                                                                                     | auto-refresh the view under the reader                                                                                     |
| Badge a file `M` / `A` / `D`                                                                                           | invent extra statuses or color-only cues                                                                                   |

## Component Patterns

Behavioral rules; visual specs live in `DESIGN.md.Components`.

| Component                                          | Use                 | Behavioral rules                                                                                                                                                              | Source                                   |
| -------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Changes row (`{components.changes-row}`)           | Changes region      | Click the row → opens that file in the shared viewer. **No** other affordance (no stage/discard/checkbox). Right-aligned M/A/D badge.                                         | prd.md FR-3; .memlog                     |
| Status badge (`{components.status-badge}`)         | Both regions        | Displays literally `M`/`A`/`D`; letter is the accessible cue.                                                                                                                 | prd.md FR-3; .memlog badge               |
| Commit-graph row (`{components.commit-graph-row}`) | Graph region        | Click a commit → its changed files **expand inline** beneath it (each an openable file row); click again to collapse. Shows lane topology + message + author + relative time. | prd.md FR-6; .memlog interactions LOCKED |
| Viewer — diff (`{components.viewer-diff}`)         | Right pane, `M`     | Two-pane red/green diff, `HEAD→worktree` (Now) or `parent→commit` (history). `+`/`-` gutter markers per line.                                                                 | prd.md FR-4:115,118; addendum.md:47      |
| Viewer — single (`{components.viewer-single}`)     | Right pane, `A`/`D` | One pane, full content, no coloring. `A` = new content; `D` = removed content (parent OID).                                                                                   | prd.md FR-4:116-117; addendum.md §API    |
| Reload (`{components.reload}`)                     | Panel chrome        | Manual re-fetch of the current region/file; never auto/poll.                                                                                                                  | prd.md FR-2                              |
| Empty state (`{components.empty-state}`)           | Whole panel         | Replaces Changes+Graph+viewer; title+body, optional Reload CTA.                                                                                                               | prd.md FR-8; .memlog empty-state LOCKED  |

## State Patterns

| State                                                 | Trigger                                                                                                                                                                                                   | Treatment                                                                                                                                                                                                                                                   | Source                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Empty — container run**                             | isolation-env `provider === 'container'` (resolved `run.conversation_id → conversation.isolation_env_id → isolationEnvironments.getById(envId).provider`, status-agnostic), gated **before any git read** | Whole-panel. Title **"No files to show"**; body **"This run executed inside a container — its working files aren't on the host to read."**; **NO CTA** (Reload can't help — files aren't on the host)                                                       | architecture.md D5:41; epics.md Story 1.1 AC:104-110; .memlog empty-state LOCKED                |
| **Empty — no readable checkout**                      | `working_path` null, directory absent at read time, or not a git checkout (host/worktree runs), decided by **directory existence at read time, never run status**                                         | Whole-panel. Title **"No worktree available"**; body **"This run's checkout isn't available or readable right now — it may not be ready yet, or it may have been cleaned up."**; **Reload CTA** (a running run's checkout may not be ready yet — transient) | prd.md FR-8:172-181; .memlog empty-state Reload CTA CORRECTED                                   |
| **Loading (viewer)**                                  | File clicked, bytes arriving                                                                                                                                                                              | List + file sizes render immediately from metadata; the **viewer paints a skeleton** with a **Cancel** affordance                                                                                                                                           | addendum.md:53; prd.md FR-5:129                                                                 |
| **Initial region load** `[ASSUMPTION]`                | Tab opened, first fetch of Changes + Graph in flight                                                                                                                                                      | A per-region **skeleton** is a _proposed_ affordance — sources specify only the **viewer** skeleton, not the region lists; the tab must not block the run screen (SM-C1). Exact treatment TBD at build                                                      | prd.md §NFR1:262 (non-blocking, cited); region-list skeleton itself not in sources (assumption) |
| **Large text**                                        | File over first-paint budget                                                                                                                                                                              | **"Load more"** paging — first paint ~256 KB / ~2,000 lines; for `M`, hunks + 3 context lines. > ~1 MB streams with Cancel; > ~50 MB **download only** (defaults, tunable at build)                                                                         | addendum.md:52-53; epics.md Story 1.4                                                           |
| **Binary**                                            | NUL byte in first 8 KB                                                                                                                                                                                    | Never dumped as text. Images (png/jpg/gif/webp/svg) render **inline**; other binaries offer **download + a ~4 KB hex peek**. Nothing is blocked                                                                                                             | addendum.md:54-55; prd.md FR-5:128                                                              |
| **Empty Changes (checkout exists, zero uncommitted)** | Live checkout, no uncommitted changes                                                                                                                                                                     | v1 shows a plain "no uncommitted changes" in the Changes region (the Graph region still renders); collapse-empty-Changes is a deferred nicety, not v1 [prd.md §6.2] — **exact copy is an Open Question**                                                    | prd.md §6.2                                                                                     |
| **Mid-view checkout loss**                            | Checkout vanishes while viewing (GC, PR/convo close)                                                                                                                                                      | Next read-time existence check routes to the **no-readable-checkout** Empty state, not a crash                                                                                                                                                              | prd.md UJ-1:44; addendum.md §Lifecycle                                                          |
| **Transient fetch / server refusal**                  | Network error; server security refusal (symlink escape, encoded traversal, invalid/unreachable OID)                                                                                                       | Server-side refusals are the acceptance gate; **client-side UX copy/placement for these is an Open Question** (not specified by sources)                                                                                                                    | addendum.md:33; architecture.md D6:40                                                           |

## Interaction Primitives

- **Open a file** — click a file row (Changes row, or a file inside an expanded commit) → shared viewer, status-keyed [prd.md FR-4; .memlog LOCKED].
- **Inspect a commit** — click a commit in the Graph → expand/collapse its `M`/`A`/`D` files inline; click a file to view its `parent→commit` diff [prd.md FR-6; .memlog LOCKED].
- **Return to Now** — scroll up; Changes is pinned at the top, so no Back control [.memlog LOCKED].
- **Reload** — manual re-fetch of the current region/file; never auto/poll [prd.md FR-2].
- **Cancel** — abort an opening/streaming file [prd.md FR-5:129].
- **Load more** — page the next chunk of a large file [addendum.md:52].
- **Resize** — drag the split between the left panel and the right viewer [architecture.md D3:35].
- **Read-only everywhere** — no stage, unstage, discard, commit, or edit action exists [prd.md §5:203].
- **Identifier contract (affects behavior):** the client sends only `runId` + a **server-returned reference** — a repo-relative path chosen from the list, or a commit ref — **never** the checkout root or an absolute/filesystem path [prd.md FR-7:158; architecture.md:39]. Filenames with `:`, a leading `-`, or glob metacharacters are valid and **must open** [addendum.md:33; epics.md Story 1.2 AC].

**Banned:** background polling / auto-refresh [prd.md §5:204]; any write/commit surface; mutating the open view underneath the reader (offer "changed — Reload" instead) [addendum.md:48].

## Commit Graph

_(Product-specific section — the commit history is a topology graph, a UX delta beyond the original spec's plain list.)_

- **Rendering:** the run branch's commits as a branch/merge **lane graph** (dots + connecting lines, like VS Code / GitLens), one row per commit, message + author + relative time [.memlog "FULL TOPOLOGY GRAPH"; imports/vscode-source-control-reference.md]. Renderer is an `[ASSUMPTION/recommended]`: reuse the already-installed **`@xyflow/react`** (the run screen Graph tab stack) or a **bespoke SVG** (windowing / pagination strategy spike-selected) — either needs **no new dependency** (verified) [graph-cost-scout.md §Verified reuse]. The renderer is a build decision, not user-confirmed.
- **Scope:** includes commits on the run branch **not merged to base** [prd.md FR-6:143].
- **Inline expansion:** click a commit → its `M`/`A`/`D` files expand inline beneath the row; click a file → `parent→commit` diff in the shared viewer [prd.md FR-6:144; .memlog LOCKED].
- **Virtualization / pagination `[ASSUMPTION/TBD by spike]`:** long histories would page via cursor pagination and likely virtualize with `@tanstack/react-virtual` over fixed `{spacing.commit-row-height}` rows — but the strategy (and whether it holds lane continuity across pages) is unverified and part of the graph spike [graph-cost-scout.md §Unverified].
- **Data delta:** the existing `log` record **adds `parents[]`** — the command format includes `%H %P` alongside message / author / date (retaining them) — so lanes/merges can be drawn [graph-cost-scout.md §data delta; addendum.md §API].
- **RISK (Open Question):** the **lane-assignment algorithm through merges** and **lane continuity across paged/virtualized boundaries** are custom and unprototyped — **medium-risk, needs a spike** before locking effort. Only the need for a _new library_ is disproven; the normative graph requirement still requires **Correct Course + an IR rerun** (a process fact, not decided by dependency reuse) [graph-cost-scout.md §Unverified].

## Accessibility Floor

Behavioral floor; visual contrast against the inherited Archon tokens lives in `DESIGN.md`.

- **Diff not color-alone (WCAG 1.4.1) — `+`/`-` markers LOCKED:** every diff line carries a **`+` / `-` gutter marker** (`+` added, `-` removed) as the confirmed non-color cue. A subtle red/green line tint (`{colors.diff-added-bg}` / `{colors.diff-removed-bg}`) is `[ASSUMPTION — default conventional treatment, not explicitly chosen]`; the markers satisfy the floor with or without it. Promote the tint to a decision only if the user explicitly picks "markers + tint" over "markers only" [.memlog a11y CORRECTION].
- **Badges are letter-carried** — `M`/`A`/`D` are readable without color [.memlog badge decision].
- **Keyboard navigation:** the Changes list, the commit Graph rows, expanded commit files, and the viewer are keyboard-focusable and operable; `Tab` order follows reading order (Changes → Graph → viewer); commit rows expand/collapse from the keyboard; the viewer scrolls and "Load more"/Cancel are reachable. _(Specific key bindings are an Open Question — no source specifies them; align with the Archon web keyboard conventions.)_
- **Focus management (WCAG 2.4.3 — reviewer-suggested, not user-confirmed):** invariant — **move focus only if a replacement removes the element the user currently has focused** (then move it to the replacement's heading / primary control, e.g. the Empty state's Reload); **otherwise retain focus where it is** and announce the update via a `role="status"` live region. **On initial / first-paint render (including a run that opens straight into an Empty state) do NOT steal focus** — announce only. Live-region text is **concise metadata only** (e.g. "Diff loaded: `run.py`, modified" / "Viewing commit abc123"), **never the diff body**. Specific key bindings stay `[OPEN]` (adopt Archon web conventions) [A11Y-4].
- **Screen reader:** file rows announce path + status ("`M`, modified"); commit rows announce message + expanded/collapsed; the viewer region announces its mode (diff vs single pane).
- **Radix/shadcn primitives** provide accessible **semantics, keyboard behavior, and focus rings** — but **WCAG-AA contrast is NOT automatic**: it is a theme responsibility and MUST be verified for the Source-Control-specific tokens (diff `+`/`-` markers and tint, M/A/D badges, dimmed path text) against the Archon palette [A11Y-1]. The **empty state is a `role="status"` region message, NOT a dialog** — announced when it appears; per the focus invariant above it takes focus **only if the replacement removed the element the user had focused**, **never on first paint and never unconditionally**.
- **Reflow / resize (WCAG 1.4.10 / 1.4.4) `[ASSUMPTION]`:** at 320px-equivalent width / 400% zoom the master-detail SHOULD reflow — the left panel and right viewer **stack** (single column, vertical scroll) rather than force 2-D scrolling; the two-pane M diff may switch to a stacked/unified view at narrow widths. Exact breakpoint behavior is a build decision [A11Y-2].
- **Resize handle:** the panel split handle is keyboard-operable (focusable, arrow-key resize) with an accessible name/role [A11Y-5].

## Open Questions & Assumptions

- **[ASSUMPTION] "changed — Reload" divergence affordance** — inferred, not decided. If server content diverges from the open view, offer a "changed — Reload" affordance rather than mutating the view. Its **visual form, placement, and no-poll divergence detection are unspecified** [prd.md §9:251; addendum.md:48; source-extract §Interactions].
- **[RISK] Commit-graph lane layout + pagination** — custom lane-assignment through merges and lane continuity across paged/virtualized rows are unprototyped, medium-risk; **Spike 3 required** before locking effort [graph-cost-scout.md §Unverified]. (No new dependency — verified. Correct Course applied 2026-09-01; Spike 3 remains the implementation gate.)
- **[OPEN] Empty-Changes copy** — the exact "no uncommitted changes" presentation (checkout exists, zero changes) is undecided; collapse-empty-Changes is deferred [prd.md §6.2].
- **[OPEN] Error / refusal UX** — client-side copy and placement for transient fetch failures and server security refusals (symlink escape, encoded traversal, invalid/unreachable OID) are not specified by any source [source-extract §Open gaps 9].
- **[OPEN] Keyboard bindings** — specific keys for navigating lists/graph/viewer are unspecified; adopt Archon web conventions at build.
- **[OPEN] Download & hex-peek presentation** — download filename/affordance and hex-peek rendering format are unspecified [addendum.md:54; source-extract §Open gaps 12].
- **[OPEN] Snapshot-sourced indication (fast-follow)** — whether the UI distinguishes durable-snapshot data from live-checkout data is undecided; FR-9 is out of v1 scope [prd.md FR-9; §6.2].
- **[DELEGATED] Dark mode / density / motion / i18n** — no source statement; inherits the Archon design system [source-extract §Open gaps 14,16,17].
- **[OPEN] Diff green token** — shadcn has no default green semantic token; `{colors.diff-added-bg}` must be bound to an Archon palette value (or react-diff-view's theme) at build (see `DESIGN.md.Colors`).
- **[ASSUMPTION] Diff line tint** — the red/green line background is a default conventional treatment, not a user-confirmed choice; the `+`/`-` markers are the locked WCAG floor. Confirm "markers + tint" vs "markers only" to promote it.
- **[ASSUMPTION] Provisional layout defaults** — the split ratio (~33/67), commit-row height (~24px), per-region independent scrolling, and the commit-graph renderer (React Flow reuse vs bespoke SVG; only "no new dependency" is verified) are distill defaults, not user-confirmed; settle at build / design review.

## Key Flow

### Kevin verifies what a run changed (UJ-1, real inspection session)

1. Kevin is watching a running (or just-finished) workflow on the Archon run screen. He opens the **Source Control** tab [prd.md UJ-1:43].
2. He looks **first** at the **Changes** region at the top of the left panel — the uncommitted files the agent is currently editing and adding, each badged `M`/`A`/`D`. He reads _which_ files the run touched [.memlog JOURNEY sequence: "đầu tiên" uncommitted Changes].
3. **Then** he drops his eye to the **Graph** region below — the run branch's commit topology — to understand what the **prior workflow nodes** did: which commits landed, on which lanes, and how they merged [.memlog JOURNEY: "sau đấy" commit history].
4. He clicks a **modified** file in Changes. The right pane opens a two-pane diff — red before, green after, each line marked `+`/`-` (`HEAD→worktree`). He reads exactly what changed [prd.md UJ-1:44; FR-4].
5. Curious about an earlier commit, he clicks it in the Graph. Its `M`/`A`/`D` files expand **inline** beneath the row; he clicks one and the right pane swaps to that commit's `parent→commit` diff [prd.md FR-6; .memlog LOCKED].
6. He suspects a file changed again on the server, so he presses **Reload** — a manual re-fetch, no polling [prd.md FR-2].
7. **Climax:** Kevin has answered _"did this run change the files I think it did?"_ entirely from the run screen — he read the live uncommitted changes, traced the commit topology of what the nodes did, and inspected two diffs — **without ever SSHing into the host or cloning the repo**. The absence of a local clone, the reason the tab exists, never surfaced as a limitation [prd.md §1; UJ-1].

**Failure branch:** if the run's checkout has already been cleaned up (or was never readable), step 2 renders the **"No worktree available"** Empty state with a **Reload** CTA instead of the file lists — a clear absence, never an error or crash [prd.md UJ-1:44 edge case; FR-8]. If the run executed inside a container, he instead sees **"No files to show"** with no CTA [architecture.md D5; .memlog].
