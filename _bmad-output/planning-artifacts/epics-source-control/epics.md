---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - ../prds/prd-source-control/prd.md
  - ../prds/prd-source-control/addendum.md
  - ../architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md
  - ../../specs/spec-archon-source-control/SPEC.md
  - ../../specs/spec-archon-source-control/brownfield.md
  - ../../specs/spec-archon-source-control/viewer-rules.md
  - ../../specs/spec-archon-source-control/architecture-diagrams.md
  - ../../specs/spec-archon-source-control/roadmap.md
excludedDocuments:
  - ../prd.md
  - ../architecture.md
  - ../epics.md
  - ../architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/
  - ../ux-designs/ux-Archon-source-control-2026-08-31/
  - ../prds/prd-source-control/architecture.md
notes: UX 2026-09-05 DESIGN/EXPERIENCE missing; UX-DRs taken from architecture AD-5/AD-6/AD-9 and viewer-rules.md. Output is this feature folder only — do not overwrite planning-artifacts/epics.md (Workflow Commander). Party 2026-09-05: Epic 1 Changes-only (no dead History pane); Epic 2 inserts History + lane graph; Epic 3 is the CAP-8 seam. Numbering is this file's; implementation story keys should be prefixed source-control- so they do not collide with Commander 3.x in a shared sprint-status.yaml. Hunk JSON in Epic 1 already carries scope now|commit and ref. Step 4 validation passed (see Validation section).
---

# Archon Source Control Tab - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Archon Source Control, decomposing the requirements from the PRD, SPEC (CAP-1–8), and the 2026-09-05 architecture spine (AD-1–AD-9) into implementable stories.

Feature-scoped directory: `_bmad-output/planning-artifacts/epics-source-control/`. This file numbers Epics **1–3**. Workflow Commander Epic 3 lives in `planning-artifacts/epics.md` (different document). HITL epics start at 5.

## Requirements Inventory

### Functional Requirements

FR1: Fourth **Source Control** tab on the **legacy** run screen (`/legacy/workflows/runs/:id`) beside Graph / Logs / Chat; two regions — uncommitted **Changes** above **commit history** — scoped to that run. Console is not a v1 surface.
FR2: Manual **Reload** only; no auto-refresh or polling. If host content diverged since load, show "Changed on disk — Reload"; never mutate the open view under the reader.
FR3: List changed files for the selected scope (Now, and per selected commit), each labelled exactly `M` / `A` / `D`. Projections: untracked→`A`; rename→`D`+`A`; copy→`A`; type-change/unmerged→`M`.
FR4: One shared status-keyed viewer — `M` two-pane diff (before left / after right); `A`/`D` single-pane content, no diff coloring. Now = `HEAD → worktree`; commit = `parent → commit`. `M` is diff-only (no standalone snapshot mode).
FR5: Every changed file opens — large text streams (Load more / Cancel); binary is not dumped as text (images inline; else download + hex peek). Nothing is blocked; usable fallback always. Thresholds: `viewer-rules.md` (first paint ~256 KB / ~2,000 lines; stream Cancel > ~1 MB; download-only > ~50 MB; NUL in first 8 KB = binary; hex peek ~4 KB).
FR6: Inspect any commit on the run branch (including commits not merged to base `dev`); same viewer; per-commit `M`/`A`/`D` list. History is a **branch/merge lane graph** (one row per commit, `parents[]` on the log record); lane-layout renderer is a pre-build spike (`@xyflow/react` reuse vs bespoke SVG — no new dep). A plain chronological list is not an acceptable fallback.
FR7: Server-resolved, run-confined, read-only access. Client sends `runId` + server-issued file/commit refs only — never `working_path` or an absolute path. No write / commit / stage / edit / discard chrome.
FR8: CAP-6 empty state when there is no readable host git checkout: `working_path` null, directory absent, not a git checkout, or container-backend (`isolation_env.provider === 'container'`). Container vs `no_checkout` are distinct reasons (Reload only on `no_checkout`). Missing `isolation_env_id` is **not** CAP-6 — fall through to host dir+git. Empty Changes ("No uncommitted changes") and Empty History ("No commits yet") are **region** messages on a live checkout, not CAP-6. Git/API failure on a valid checkout is an in-region error + Reload, not CAP-6.
FR9: Durable run-end snapshot under `output_root` so history/diffs survive checkout cleanup — **SHOULD / not v1**. Live checkout is primary; snapshot is fallback. v1 implements the `WorkflowDeps` finalize **seam** only (no write).

### NonFunctional Requirements

NFR1 (Performance): Fetch on click with explicit loading; no measurable regression to the run screen; large content streams/virtualizes; reads on-demand only (no polling, no server-side git-result cache).
NFR2 (Security / containment): Resolve `workflow_runs.working_path` server-side (existing column — do not add one, do not re-derive from isolation metadata); realpath it. Live reads: realpath-contain under checkout. Commit reads: `ls-tree -z` + `cat-file blob` — never `oid:path`. Reject NUL / absolute / encoded `..`. Filenames with `:`, leading `-`, or glob metacharacters MUST succeed (`--literal-pathspecs`). `execFileAsync` / `@archon/git` only — no shell-string git. Strictly read-only.
NFR3 (Reliability): Vanished checkout → CAP-6, never a crash. Existence at read time, not run status. CAP-8 write failure logs and does not fail the run.
NFR4 (Compatibility): `registerOpenApiRoute` for JSON; raw `app.get` only for wildcard file content (artifacts precedent). `@archon/web` consumes `api.generated.d.ts` only. No new tables in v1. No new process, env var, or deployable.
NFR5 (Observability): Named Pino events in domain.action_state form; never log paths, remotes, file contents, or secrets.
NFR6 (Privacy / secrets — residual risk): v1 ships without redaction/denylist; viewer can surface `.env`/keys; accepted for trusted internal users; recorded for revisit.
NFR7 (Accessibility): Diffs carry `+`/`-` gutters; badges carry the letter `M`/`A`/`D` — never color-only (WCAG 1.4.1). Changes list, history, and viewer are keyboard-operable. Diff markers ≥ 4.5:1; if a lane graph ships, lanes ≥ 3:1 non-text and not color-only.
NFR8 (Auth): Git routes follow run-detail and `/api/artifacts/:runId/*` — global `/api/*` gate only; no `requireWebUser`; no per-run owner ACL in v1.

### Additional Requirements

- Brownfield: no starter template. Git-read helpers live in `@archon/git` (`changedFiles`, `fileDiff`, `fileAt`, `log`) on `execFileAsync`. Routes stay thin (resolve, gate, serialize). No `@archon/source-control` package.
- Transport: JSON OpenAPI for changes / log / per-commit files / `M` hunks. Raw wildcard for file content / binary / ranges.
- Canonical hunk JSON (not unified-diff wire): `{ path, status: "M", scope: "now"|"commit", ref, hunks, cursor, truncated }`. `ref` is `"live"` for Now (never null). `cursor` is an opaque string echoed as `?cursor=`; web must not parse it as a scroll offset. Web adapter maps to react-diff-view `HunkData`/`ChangeData` in a tested pure function. `A`/`D` use the raw content route, not the hunk endpoint.
- Viewer stack: one new dep `react-diff-view@3.3.3`; syntax via installed `highlight.js@^11.11.1`; lists/diffs via installed `@tanstack/react-virtual@^3`. Do not add Shiki or Monaco. Count lodash runtime dep in the large-diff spike (~2 MB first-paint, ~1s rule).
- CAP-6 envelope: HTTP 200 + `{ emptyReason: "container" | "no_checkout" }` on **every** git route (JSON and raw); never 404 for this case. Container gate on every git route including log — no "history is immutable" exemption.
- Live git is source of truth; `workflow_events` never author the change list.
- CAP-8 seam: `WorkflowDeps` finalize hook; idempotent; temp+rename under `output_root`; v1 does not implement the write.
- `log` records include `parents[]` (for the lane graph). Lane-graph renderer spike is a pre-history-story blocker (PRD FR-6; not pinned in the architecture Stack table).
- Containment tests: symlink-escape refuse; encoded `..` refuse; colon / leading-dash / glob filename SUCCESS; container top-level → CAP-6.
- Route path seed (not locked): `/api/workflows/runs/:runId/git/{changes,log,diff}` and `/api/workflows/runs/:runId/git/file/*` — OpenAPI schemas own the final names.
- Web folder seed: `packages/web/src/components/workflows/source-control/`.

### UX Design Requirements

UX-DR1: Default split **30% lists / 70% viewer**, user-resizable **20–70%** via the screen's existing `ResizablePanelGroup`.
UX-DR2: `M` two-pane diff: each pane scrolls independently (horizontal and vertical); never overflow the window. Below **900px**: stack lists-above-viewer; before-over-after.
UX-DR3: Shared reusable viewer component (HITL reuse is COULD); do not weld it into the tab; do not import `/console`.
UX-DR4: File-row pattern with letter-carried `M`/`A`/`D` badges; one list widget feeds both Changes and History scopes.
UX-DR5: Loading: skeleton rows in the list immediately from metadata; viewer skeleton while bytes arrive; **Cancel** on in-flight open; **Load more** for chunked text.
UX-DR6: Stale-content banner copy is **Changed on disk — Reload**; never rewrite the open pane underneath the reader.
UX-DR7: CAP-6 copy is one plain sentence, no error chrome / warning icon. Container empty: **no** Reload CTA. `no_checkout`: Reload CTA. Region empties: "No uncommitted changes" / "No commits yet". API error on a live checkout: keep the list, Reload in-region — never a modal or toast stack. Never invent alarm copy ("Error:", "unsupported", "⚠️").
UX-DR8: Image binaries render inline; non-image binaries offer download + ~4 KB hex peek — never dump binary as text.
UX-DR9: Keyboard-operable Changes list, history, and viewer.

### FR Coverage Map

FR1: Epic 1 (tab + Changes region) and Epic 2 (History region + lane graph). Epic 1 must not ship a dead History pane.
FR2: Epic 1 — manual Reload, stale banner, never mutate the open view.
FR3: Epic 1 (Now lists) and Epic 2 (per-commit lists).
FR4: Epic 1 (Now viewer) and Epic 2 (commit viewer, same component). Epic 1 hunk JSON already includes `scope: now|commit` and `ref`.
FR5: Epic 1 — every file opens (stream / Cancel / binary fallbacks).
FR6: Epic 2 — inspect any run-branch commit; lane graph required; plain list is not a fallback.
FR7: Epic 1 — server-resolved, run-confined, read-only.
FR8: Epic 1 — CAP-6 + CTA split + region empties + NULL env is not CAP-6.
FR9: Epic 3 — `WorkflowDeps` finalize seam only; no snapshot write in v1.

## Epic List

### Epic 1: Inspect this run's live changes

After this epic, an operator opens **Source Control** on a legacy run and can answer “what is uncommitted on this checkout?” — tab, Changes-only list (no History region), Reload / stale banner, Now `M`/`A`/`D`, shared viewer (diff / add / delete, large + binary), server-resolved read-only git, CAP-6 vs region empties vs in-region errors. 30/70 split arrives with the viewer; do not ship a dead 70% pane in the list-only story.

**FRs covered:** FR1 (tab + Changes), FR2, FR3 (Now), FR4 (Now + commit-scope types on the wire), FR5, FR7, FR8
**UX-DRs:** UX-DR1–UX-DR9 except History-specific pieces (lane a11y, History keyboard, “No commits yet”).
**Depends on:** nothing in this feature set. Legacy run screen already exists.
**Enables:** Epic 2 inserts History + lane graph into this tab; Epic 3 adds the finalize seam.
**Implementation notes:** `@archon/git` `changedFiles` / `fileDiff` / `fileAt` (not `log`) + thin routes; CAP-6 gate helper reused later by `log`; hunk JSON `{ path, status, scope, ref, hunks, cursor, truncated }` with `ref: "live"` for Now; `react-diff-view@3.3.3`; web folder `packages/web/src/components/workflows/source-control/`. No write chrome. No poll.

### Epic 2: Inspect this run's commit history

After this epic, the same operator sees a **History** region on that tab, walks the **run-branch lane graph**, selects any commit (including not-on-`dev`), and sees that commit’s `M`/`A`/`D` in the **same** viewer.

**FRs covered:** FR1 (History region), FR6, FR3 (commit scope), FR4 (commit scope)
**UX-DRs:** History keyboard, “No commits yet”, lane non-text contrast (NFR7).
**Depends on:** Epic 1 tab, viewer, git read path, CAP-6 gate helper.
**Does not require a later epic.**
**Implementation notes:** `log` with `parents[]`. Lane-graph spike (`@xyflow/react` reuse vs bespoke SVG — no new dep) is the first story and a blocker; a plain chronological list is not acceptable. Container gate on `log` — no “history is immutable” exemption.

### Epic 3: Keep a seam for durable git evidence

After this epic, run finalize has the **CAP-8 `WorkflowDeps` hook** (idempotent, temp+rename under `output_root`). v1 does **not** write the snapshot; a write failure must never fail the run.

**FRs covered:** FR9
**Depends on:** Epic 1 only if the hook needs the same git helpers; does not require Epic 2.
**Does not require a later epic.**
**Implementation notes:** AD-8. Write format stays a build-time decision. No new tables.

## Epic 1: Inspect this run's live changes

After this epic, an operator opens Source Control on a legacy run and can answer “what is uncommitted on this checkout?” History is not part of this epic.

### Story 1.1: See this run's uncommitted files

As an operator,
I want a Source Control tab on the legacy run screen that lists this run's uncommitted files,
So that I can tell whether the run changed the paths I expect without opening a checkout.

**Implements:** FR1 (tab + Changes only), FR2, FR3 (Now), FR7, FR8, NFR2, NFR5, NFR8, UX-DR4 (letter badges), UX-DR6, UX-DR7, UX-DR9 (list)

**Acceptance Criteria:**

**Given** I am on `/legacy/workflows/runs/:id`
**When** I open the fourth tab beside Graph / Logs / Chat
**Then** I see **Source Control** scoped to that run
**And** Console is not a v1 surface
**And** there is a **Changes** region and **no History region**

**Given** the run has a readable host git checkout with uncommitted changes
**When** the tab loads (fetch on click, no poll)
**Then** Changes lists each path with exactly `M` / `A` / `D` (letter on the badge, not color-only)
**And** untracked → `A`; rename → `D` + `A`; copy → `A`; type-change / unmerged → `M`
**And** the list is keyboard-operable
**And** `workflow_events` do not author the list

**Given** a readable checkout with a clean worktree
**When** the tab loads
**Then** Changes shows **No uncommitted changes** (region empty, not CAP-6)

**Given** no readable host git checkout (`working_path` null, directory missing, not a git checkout, or `isolation_env.provider === 'container'`)
**When** any git route for this run is called
**Then** HTTP **200** with `{ emptyReason: "container" | "no_checkout" }` (never 404 for this case)
**And** the tab shows one plain sentence, no error chrome / warning icon
**And** `container` has **no** Reload; `no_checkout` has Reload
**And** missing `isolation_env_id` is **not** CAP-6 — fall through to host dir+git

**Given** a valid checkout whose git/API call fails
**When** the request errors
**Then** the list remains
**And** Reload is in-region (no modal, no toast)
**And** copy is not alarm (“Error:”, “unsupported”, “⚠️”)

**Given** the tab has loaded
**When** I click Reload
**Then** lists refetch
**And** if host content diverged since load, I see **Changed on disk — Reload**
**And** the open view is never rewritten underneath me

**Given** the client
**When** it requests git data
**Then** it sends `runId` only (plus server-issued refs later); never `working_path` or an absolute path
**And** the server reads existing `workflow_runs.working_path` (no new column, no re-derive from isolation metadata), `realpath`s it
**And** helpers live in `@archon/git` (`changedFiles` via `execFileAsync`); routes resolve, gate, serialize
**And** JSON uses `registerOpenApiRoute`; web types from `api.generated.d.ts` only
**And** auth matches `/api/artifacts/:runId/*` (global `/api/*` gate; no `requireWebUser`; no per-run owner ACL)
**And** Pino events are `domain.action_state`; no paths, remotes, contents, or secrets
**And** tests: symlink-escape refuse; encoded `..` refuse; `:`, leading `-`, glob filenames SUCCESS; container top-level → CAP-6
**And** no write / commit / stage / edit / discard chrome
**And** the layout has no empty 70% viewer column — Changes is the working surface until Story 1.2

### Story 1.2: Open a changed file in the shared viewer

As an operator,
I want to open a file from the Changes list in a status-keyed viewer,
So that I can see what actually changed without leaving the run screen.

**Implements:** FR4 (Now), FR7 (file reads), NFR2, NFR4, NFR7, UX-DR1–UX-DR5, UX-DR9 (viewer)

**Acceptance Criteria:**

**Given** Story 1.1’s tab and Now list
**When** I select a changed file
**Then** it opens in one shared viewer in `packages/web/src/components/workflows/source-control/`
**And** the viewer is reusable (not welded into the tab; no `/console` import)
**And** the list widget is reusable for a later History file-list scope
**And** the screen split is **30% lists / 70% viewer**, resizable **20–70%** via the existing `ResizablePanelGroup`

**Given** status `M`
**When** the file opens
**Then** I see a two-pane diff, before left / after right (`HEAD → worktree`)
**And** each pane scrolls independently (horizontal and vertical) and does not overflow the window
**And** gutters show `+` / `-` (not color-only)
**And** diff markers meet contrast ≥ 4.5:1 (NFR7)
**And** there is no standalone snapshot mode

**Given** status `A` or `D`
**When** the file opens
**Then** I see a single pane of content with no diff coloring
**And** `A`/`D` use the raw content route, not the hunk endpoint

**Given** the `M` diff API
**When** it returns JSON
**Then** the body is `{ path, status: "M", scope: "now"|"commit", ref, hunks, cursor, truncated }`
**And** Now uses `scope: "now"` and `ref: "live"` (never null)
**And** `cursor` is an opaque string echoed as `?cursor=`; the web does not parse it as a scroll offset
**And** a tested pure function maps hunks to react-diff-view `HunkData` / `ChangeData`

**Given** below **900px**
**When** I open the tab
**Then** lists stack above the viewer
**And** an `M` diff stacks before-over-after

**Given** bytes are in flight
**When** I open a file
**Then** the list can skeleton from metadata
**And** the viewer shows a skeleton
**And** I can **Cancel** the in-flight open
**And** the viewer is keyboard-operable

**Given** the server
**When** it reads a path
**Then** live reads realpath-contain under the checkout
**And** commit-shaped blob reads (needed for `M` before-side) use `ls-tree -z` + `cat-file blob` — never `oid:path`
**And** `--literal-pathspecs`; `fileDiff` / `fileAt` in `@archon/git`; routes stay thin
**And** JSON via `registerOpenApiRoute`; raw `app.get` only for wildcard file content
**And** every git route still returns CAP-6 as HTTP 200 + `emptyReason`
**And** one new dep: `react-diff-view@3.3.3`; syntax via installed highlight.js; virtualize via installed `@tanstack/react-virtual`
**And** do not add Shiki or Monaco

**Given** a file whose first 8 KB contains NUL
**When** I open it
**Then** it is not dumped as text
**And** a usable non-text fallback is enough (download-only is OK); inline image + hex peek are Story 1.3
**And** Load more / >1 MB stream / >50 MB download-only are Story 1.3

### Story 1.3: Open every changed file

As an operator,
I want every changed file to open or give a usable fallback,
So that large text and binaries never block inspection or get dumped as garbage.

**Implements:** FR5, NFR1, NFR6, UX-DR5 (Load more), UX-DR8

**Acceptance Criteria:**

**Given** Story 1.2’s viewer
**When** I open a large text file
**Then** first paint is about **256 KB / 2,000 lines** (tunable at build; do not invent a parallel cutoff)
**And** I get **Load more** for the rest
**And** for `M`, the API sends hunks plus **3 lines of context**, not the whole file
**And** files **> ~1 MB** stream with **Cancel**
**And** files **> ~50 MB** are download-only (still a usable fallback — nothing is blocked)

**Given** a binary (NUL in the first 8 KB, git heuristic)
**When** I open it
**Then** it is never dumped as text
**And** png / jpg / gif / webp / svg render **inline**
**And** other binaries offer **download + ~4 KB hex peek**

**Given** lists and diffs that exceed a comfortable first paint
**When** they render
**Then** they virtualize (`@tanstack/react-virtual` already in 1.2)
**And** the large-diff spike counts `react-diff-view`’s lodash runtime (~2 MB first paint / ~1s rule)
**And** there is no polling and no server-side git-result cache
**And** opening the tab does not measurably regress the rest of the run screen (NFR1)

**Given** NFR6
**When** this story ships
**Then** there is still no redaction/denylist (accepted residual; `.env`/keys can appear)

## Epic 2: Inspect this run's commit history

After this epic, an operator walks the run-branch lane graph, selects any commit, and sees that commit's files in the same viewer.

### Story 2.1: Walk this run's commit history as a lane graph

As an operator,
I want to see this run checkout's commits as a branch/merge lane graph,
So that I can find commits that never landed on `dev`, not just a flat log.

**Implements:** FR1 (History region), FR6 (lane graph + unmerged-to-dev commits), FR8 (“No commits yet”), NFR7 (lane contrast), UX-DR7, UX-DR9 (history)

**Acceptance Criteria:**

**Given** Story 1.1–1.3's Source Control tab (Changes only so far)
**When** this story ships
**Then** a **History** region is inserted below Changes
**And** a plain chronological list is **not** an acceptable fallback
**And** this story does **not** require opening a commit’s files (Story 2.2)

**Given** a readable checkout with commits
**When** History loads
**Then** each commit is one row driven by `log` records that include `parents[]`
**And** I can inspect commits on the run branch that are **not** merged to base `dev`
**And** History is keyboard-operable
**And** lanes meet non-text contrast ≥ 3:1 and are not color-only (NFR7)

**Given** a readable checkout with no commits
**When** History loads
**Then** I see **No commits yet** (region empty, not CAP-6)

**Given** CAP-6 (container / `no_checkout`)
**When** the `log` route is called
**Then** HTTP 200 + `{ emptyReason }` like every other git route
**And** there is **no** “history is immutable” exemption for containers
**And** `log` lives in `@archon/git` via `execFileAsync`; the route stays thin
**And** JSON uses `registerOpenApiRoute`; web types from `api.generated.d.ts` only

**Given** the lane-layout renderer is not pinned in the architecture Stack
**When** implementation starts
**Then** a pre-build spike chooses **`@xyflow/react` reuse vs bespoke SVG**
**And** that spike adds **no new dependency**
**And** the chosen renderer is what ships in this story — not a later polish pass

### Story 2.2: Open a commit's files in the same viewer

As an operator,
I want to select a commit on the lane graph and see its `M` / `A` / `D` files in the shared viewer,
So that I can inspect what that commit changed, including commits not on `dev`.

**Implements:** FR3 (commit lists), FR4 (commit viewer), FR6 (inspect selected commit), FR7, UX-DR4 (same list widget both scopes)

**Acceptance Criteria:**

**Given** Story 2.1's History graph and Story 1.2's viewer
**When** I select a commit
**Then** the file list shows that commit's changed paths with exactly `M` / `A` / `D` and the same projections as Now
**And** opening a file uses the **same** viewer component
**And** `M` compares `parent → commit`; `A`/`D` show that commit's blob / parent blob via the raw content route
**And** hunk JSON uses `scope: "commit"` and `ref` equal to the commit OID (never `"live"`)
**And** the client sends only `runId` plus server-issued commit/file refs — never `working_path`

**Given** I then select Now / the Changes region
**When** the list and viewer update
**Then** scope returns to `now` / `ref: "live"`
**And** Reload and the stale banner still apply; the open view is never mutated underneath me

**Given** the server
**When** it lists or diffs a commit
**Then** `changedFiles` / `fileDiff` / `fileAt` accept a commit ref
**And** blob reads stay `ls-tree -z` + `cat-file blob` — never `oid:path`
**And** every new git route still returns CAP-6 as HTTP 200 + `emptyReason`
**And** per-commit routes are `registerOpenApiRoute` JSON except wildcard file content

## Epic 3: Keep a seam for durable git evidence

After this epic, run finalize has a CAP-8 hook. v1 does not write the snapshot.

### Story 3.1: Add the run-end git-snapshot seam

As an operator,
I want run finalize to expose a durable git-snapshot hook without changing run success,
So that a later story can write history under `output_root` after checkout cleanup without inventing a second injection point.

**Implements:** FR9, NFR3, NFR4 (no new tables)

**Acceptance Criteria:**

**Given** `WorkflowDeps` in `@archon/workflows`
**When** this story ships
**Then** there is an optional finalize hook for CAP-8 (name owned by the implementation; injected like other optional deps)
**And** the executor calls it at **run-end** (the locked trigger)
**And** v1's implementation is a **no-op write** — it does not persist name-status, diffs, A/D content, or `git log`

**Given** the hook is invoked
**When** the checkout is already gone
**Then** it no-ops
**And** a future writer must be idempotent and use temp+rename under the run's `output_root`
**And** a write/hook failure is logged (`domain.action_state`) and **must not fail the run** (NFR3)

**Given** v1 git read APIs
**When** neither checkout nor snapshot exists
**Then** they still fall through to CAP-6
**And** no new tables, process, env var, or deployable
**And** the snapshot wire format (JSON manifest serving the same read API) remains a build-time decision — not implemented here

## Validation (step 4)

- **FRs:** FR1–FR9 each appear in at least one story (see **Implements** lines). FR1 is complete only after 2.1 (History inserted; Epic 1 is Changes-only by party lock).
- **UX-DRs:** UX-DR1–9 covered (1.1–1.3 + 2.1–2.2).
- **Architecture:** brownfield, no starter template, no new tables in v1. Helpers created when the story needs them (`changedFiles` in 1.1; `fileDiff`/`fileAt` in 1.2; `log` in 2.1).
- **Dependencies:** 1.1 → 1.2 → 1.3 → 2.1 → 2.2. Epic 3 (3.1) does not require Epic 2. No story waits on a later story.
- **Known size risk:** 2.1 is spike-then-ship (lane graph). Approved; not split.
