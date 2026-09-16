# UX Source Extract — Archon "Source Control" Tab (bmad-ux Create input)

Read-only extraction from the 7 confirmed files in `../../prds/prd-source-control/`. DECIDED items carry citations; OPEN gaps are separated below. No source files were modified. (Subagent: UxSourceExtract.)

## Inherited / decided (with citations)

### Foundation

- **Form factor:** a fourth tab, **Source Control**, on the existing workflow-run screen, beside Graph / Logs / Chat [prd.md §3 glossary; §4.1:63; FR-1 consequence:73]. Run screen already reads `workingPath` (`packages/web/src/components/workflows/WorkflowExecution.tsx`) [addendum.md §Key Archon code references].
- **Product thesis:** run-scoped git inspector answering "did this run change the files I think it did?" — deliberately NOT an embedded IDE or generic file browser; absence of a local clone is the reason the feature exists [prd.md §1; §5].
- **UI stack (decided, D3):** `react-diff-view` (the one new dep) + already-installed `highlight.js` (tokenization), `react-resizable-panels` (the split), `@tanstack/react-virtual` (large content), `@tanstack/react-query` (fetching); do NOT add Shiki; Monaco rejected [architecture.md:35]. Web consumes OpenAPI-generated types only [architecture.md:42; prd.md §Compatibility:265].
- **Stakes/audience:** internal tooling, single operator role, one light journey (UJ-1, protagonist Kevin) [prd.md §2.3:43-44]; trusted internal users with run visibility, no per-tab restriction [prd.md §9:250]; strictly read-only is a hard guardrail [prd.md §Constraints:271]; low-risk → ship without feature flag [prd.md §Rollout].
- **Performance contract:** fetch-on-click with explicit loading feedback; no hard SLA; must not regress run-screen responsiveness (SM-C1); tab never blocks the run screen [prd.md §Cross-Cutting NFRs:262; §7 SM-C1]. ~1s first-paint is only Spike 1's heuristic, not an SLA [architecture.md:54; epics.md Story 1.2 AC].

### Information architecture

- **Two regions, VS Code shape:** Changes region (uncommitted, "Now") **above** commit history region, both scoped to the run; "shaped like VS Code's Source Control panel" [prd.md §4.1:63; FR-1:71-74].
- **One list widget, one viewer:** both regions feed the same list + same Viewer; only the read scope differs [addendum.md:37].
- **Changes region:** the run's uncommitted changed file paths, each badged exactly one of `M`/`A`/`D` [prd.md FR-3:93-101].
- **Commit history region:** commits on the run's own branch (incl. commits not merged to base); click a commit → its M/A/D file list [prd.md FR-6 §4.4; addendum.md §Diagrams; epics.md Story 2.1/2.2]. Placement: **below** the Changes region [epics.md Story 2.1 AC].
- Only changed files appear — no Explorer tree of unchanged files [prd.md §5:205].

### Viewer: modes, diff direction, panes

- **Single shared Viewer, keyed by status** [prd.md §4.3:105; FR-4]:
  - `M` → **two-pane diff**, red = before / green = after [prd.md:115; addendum.md:40-44].
  - `A` → **single pane**, new file's full content, **no diff coloring** [prd.md:116].
  - `D` → **single pane**, removed file's content, **no diff coloring** [prd.md:117].
- **Diff direction:** Now = `HEAD → worktree`; selected commit = `parent → commit`; before = left/red, after = right/green [prd.md:118; addendum.md:49].
- **M is diff-only in v1** — no standalone snapshot mode [prd.md:119; §5; addendum.md:48].
- **Status set exactly M/A/D:** untracked-new → `A`; rename → `D`+`A`, copy → `A`, type-change → `M`, unmerged → `M` [prd.md FR-3:99; addendum.md:38].
- **Diff rendering:** server-computed canonical hunk JSON → thin tested web adapter → react-diff-view; endpoint never emits unified-diff text [architecture.md:37].

### State patterns

- **Empty state:** explicit "no worktree / not available" view [prd.md §3:56; FR-8:172-174]. Triggers: `working_path` null; directory absent at read time; not a git checkout; container-backend run (host path stale) [prd.md FR-8:174,181]. Shown instead of error/crash [prd.md:75,178]. Presence by directory existence at read time, **not** run status [prd.md:180; §Reliability:264]. Container runs gated to Empty **before any git read** [architecture.md:41; epics.md Story 1.1 AC]. Neither checkout nor snapshot → Empty [architecture.md:43; epics.md Story 3.2 AC].
- **Loading:** fetch-on-click with explicit feedback [prd.md:262]; list + file sizes render immediately from metadata; Viewer paints a **skeleton** while bytes arrive, with **Cancel** [addendum.md:53; prd.md:129].
- **Large text:** streamed/chunked with **"Load more"** — first paint ~256 KB / ~2,000 lines; for `M`, hunks + 3 context lines [addendum.md:52; prd.md:127; epics.md Story 1.4]. > ~1 MB stream w/ Cancel; > ~50 MB **download only** (defaults, tunable at build) [addendum.md:53].
- **Binary:** NUL byte in first 8 KB; never dumped as text; images (png/jpg/gif/webp/svg) render **inline**; other binaries offer **download + hex peek** of first ~4 KB [addendum.md:54; prd.md:128].
- **Invariant:** nothing is blocked — every file opens or presents a usable fallback [addendum.md:55; prd.md FR-5].
- **Mid-view checkout loss:** checkout can vanish while viewing → read-time existence check → "no worktree / not available" [prd.md UJ-1:44; addendum.md §Lifecycle/GC; §Reliability:264].

### Interactions

- **Open file:** click file in either region → shared Viewer [prd.md:105; UJ-1:44].
- **Commit inspection:** click commit in history → its M/A/D files + diffs via same Viewer (`parent→commit`) [prd.md FR-6; epics.md Story 2.2].
- **Reload:** manual control re-fetches current region/file; **never** auto-refresh/poll [prd.md FR-2:79-84; addendum.md:50].
- **Divergence affordance:** if server content changed since load, offer a **"changed — Reload"** affordance rather than mutating the open view `[ASSUMPTION, inferred]` [prd.md:85; §9:251; addendum.md:50].
- **Cancel** an opening/streaming file [prd.md:129]; **Load more** paging [addendum.md:52]; **read-only** everywhere [prd.md §5:203].

### Security / identifier contract affecting UX

- Client sends only `runId` + a **server-returned reference** (repo-relative path chosen from the list, or a commit ref) — never the checkout root or an absolute/filesystem path [prd.md FR-7 §4.5; architecture.md:39; epics.md NFR2].
- Filenames with `:`, leading `-`, or glob metachars are **valid and MUST open** (FR-5) — server uses `--literal-pathspecs` + `--`/argv [architecture.md:40; addendum.md:33; epics.md 1.2/2.2 ACs].
- Refused requests (symlink escape, encoded traversal, invalid/unreachable OID) are server-side; named security tests are the acceptance gate [architecture.md:40; IR report §Recommendations].

### Explicit visual/typography/color/density/dark-mode/a11y/motion/i18n hints

- **Only color decisions in the whole source set:** red = before, green = after (M diff); A/D panes uncolored [prd.md:115-117; addendum.md table].
- **Shape model:** "VS Code's Source Control panel" [prd.md:63]; "two-region VS Code-style layout" [epics.md §UX Design Requirements].
- **Visual polish delegation:** UX inline + consistent with existing Archon web tokens; exact spacing/tokens left to implementation using the existing design system [IR report:105].
- **No** dark-mode, typography, density, motion, a11y, or i18n statements exist in any source (docs authored in English = document language, not UI-copy policy) [prd.md §9:254].

## Open UX gaps (not resolved by sources) — coaching agenda

1. **Viewer placement / spatial layout** — specs say "two regions + shared viewer" but never where the Viewer renders (below lists / split pane / overlay / replaces a region). Mermaid shows only logical edges, no geometry [addendum.md §Diagrams].
2. **What `react-resizable-panels` splits** — "the split" named but not defined (diff panes vs list/viewer); default sizes unspecified [architecture.md:35].
3. **Selection model across regions** — where the per-commit file list renders (replace Changes list? third area?), how to return to "Now", back/breadcrumb — unspecified.
4. **Commit-history presentation** — columns (message/author/date/SHA), truncation, ordering, virtualization of long logs — unspecified.
5. **File-list presentation** — flat vs directory-grouped, sort order, long-path truncation/wrapping, per-region counts — unspecified.
6. **Empty Changes region** (checkout exists, zero uncommitted) — distinct from FR-8 Empty; "collapse-empty-Changes" is a _deferred nicety_, so v1 "no changes" presentation undecided [prd.md §6.2].
7. **Reload control specifics** — global vs per-region/per-viewer, placement, "current region/file" scope [prd.md:83].
8. **"Changed — Reload" affordance** — inferred assumption only; visual form, placement, divergence detection without polling — unspecified [prd.md:85,251].
9. **Error states beyond Empty** — transient fetch/server failures; UX of server security refusals (symlink escape, invalid OID) — no UI copy/behavior specified.
10. **Empty-state copy & visual** — "no worktree / not available" is wording-intent; final copy, icon/illustration, CTA (offer Reload?) — unspecified [prd.md:56,174].
11. **Loading affordance specifics** — skeleton shape, post-Cancel state, Load-more placement/increment — unspecified [addendum.md:52-53].
12. **Download & hex-peek presentation** — download filename/affordance, hex-peek rendering format — unspecified [addendum.md:53-54].
13. **Snapshot-sourced indication** (fast-follow) — whether the UI distinguishes snapshot-fallback from live-checkout data — unspecified [prd.md FR-9; architecture.md:43].
14. **Dark mode / typography / density / spacing tokens** — delegated to existing Archon design system, not specified here [IR report:105].
15. **Accessibility** — zero mentions: keyboard nav, focus management, ARIA, color-blind-safe alternative to red/green — all open.
16. **Motion/animation** — unaddressed.
17. **i18n / UI-copy language** — unaddressed (docs English; no UI-string policy).

## Notes from supporting docs

- **IR report — UX warning:** no standalone UX doc; UI clearly implied; recorded as warning; severity reduced (UX inline in PRD UJ-1/§4 + architecture viewer rules/tab-layout diagram); visual polish delegated to existing design system; **not a readiness blocker** [IR report:23,29,105,122,141]. Step 4 alignment issues: none — every UI element has architectural support.
- **IR report — reconciled identifier/path contract** (was a normative cross-doc conflict): resolved to server-returned repo-relative path; checkout root server-derived from `runId`; validated server-side [IR report:115,140].
- **epics.md meta:** "No standalone UX contract exists; UX inline (two-region VS Code-style layout, status-keyed M/A/D viewer, red/green diff, manual Reload, Empty state, large/binary open behavior). Not extracted as separate UX-DR items" [epics.md §UX Design Requirements].
- **Reconcile — PASS:** all viewer/diff/threshold rules preserved; G1 snapshot trigger re-locked run-end (format open); G2 container empty-state added to FR-8; G3 "radar" metaphor → "run-scoped git inspector". UX-honoring evolution: three states M/A/D (over older M/A). ⚠️ **SUPERSEDED:** reconcile's "empty-state = directory existence at read time only (not env/run status)" is overridden by the current D5 contract — the **container gate is provider-based** (isolation-env `provider==='container'`, before any git read) [architecture.md:41; epics.md:104-110]; directory-existence applies to host/worktree runs only. Run _status_ is still never the detector. Do NOT ingest "directory-only" as a live UX decision.
- **Review — PASS:** off-by-one FR cross-refs already fixed in current prd.md; residual minor (SM-1 instrument unnamed; Assumptions-Index roundtrip) — neither blocks UX.
