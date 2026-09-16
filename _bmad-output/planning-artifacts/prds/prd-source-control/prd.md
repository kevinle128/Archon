---
title: Archon Source Control Tab
status: final
created: '2026-08-30'
updated: '2026-09-01'
source: Distilled from spec-archon-source-control (SPEC.md + brownfield/viewer-rules/architecture-diagrams/roadmap) and brainstorm-intent. Self-contained for isolated Archon implementation per the cross-project handoff contract.
companions:
  - addendum.md
---

# PRD: Archon Source Control Tab

## 0. Document Purpose

This PRD defines the user-facing requirements for a **Source Control** tab on the Archon workflow-run screen, for the PM, and for the downstream architecture, epics, and implementation agents that build it inside the `archon` subproject.
Features are grouped by capability; functional requirements use globally stable IDs (FR-N); inferred items are tagged inline with `[ASSUMPTION]` and indexed in §9.
Technical depth (git command mapping, endpoint shapes, viewer rules, thresholds, snapshot format, existing-code constraints, diagrams) lives in the companion `addendum.md`; this document and that addendum are self-contained so an isolated Archon implementation agent needs no parent-workspace files.

## 1. Vision

Archon runs workflows on a remote server; the operator watches them in a browser that has no clone of the repo. Today the run screen shows Graph / Logs / Chat — it can tell you a node ran and what command it issued, but not **what the repo became**. After a run touches files, the operator cannot answer the one question that matters: _"did this run change the files I think it did?"_

The Source Control tab answers that question in the UI. For the run being viewed, it shows the run's uncommitted changes and its commit history, read directly from the run's own remote checkout, and opens any changed file as a diff — without SSH and without a local clone. The absence of a local repo is the reason the feature exists, not a limitation: this is a run-scoped git inspector, deliberately not an embedded IDE or a generic file browser.

## 2. Target User

### 2.1 Jobs To Be Done

- **Verify a run's effect:** confirm a run (or a specific node) touched the files the operator expected, by reading the actual changes.
- **Inspect content, not just names:** see _what_ changed inside a file (a diff), and read a newly added or deleted file's content.
- **Audit history:** open any commit the run produced and see its file set and diffs.
- **Do it remotely:** all of the above from the run screen, against the remote server, with no SSH or clone.

### 2.2 Non-Users (v1)

- Anyone wanting to _edit_ or _commit_ from the UI — this is strictly read-only.
- Anyone inspecting a run that executes inside a **container backend** — out of v1 (see §5, §6.2).

### 2.3 Key User Journey

Internal tooling with a single operator role, so one light journey suffices.

> **UJ-1. An operator checks what a run changed, from the run screen.**
> Kevin is watching a running (or just-finished) workflow on the Archon run screen. He opens the **Source Control** tab. The **Changes** region lists the run's uncommitted files, each badged `M`, `A`, or `D`; below it, the **commit-history graph** shows the run's commits as branch/merge lanes. He clicks a modified file and sees a two-pane diff (red before / green after); he clicks a newly added file and reads its full content. He clicks an older commit in the history and sees that commit's files and diffs. Everything is read from the run's remote checkout; he never SSHed or cloned. When he suspects the file changed again on the server, he presses **Reload**. **Edge case:** if the run's checkout has already been cleaned up, the tab shows a clear "no worktree / not available" state instead of an error.

## 3. Glossary

- **Source Control tab** — the new fourth tab on the workflow-run screen, beside Graph / Logs / Chat.
- **Run** — a single Archon workflow execution, addressed by `runId`.
- **Run checkout** — the on-disk directory a run executed in, recorded on the run row as `working_path`. Usually an isolated git worktree; may also be an in-place or `--no-worktree` git repo checkout.
- **`working_path`** — the absolute path of the Run checkout, persisted on the run and exposed at `GET /api/workflows/runs/{runId}`.
- **Changes region** — the list of the run's _uncommitted_ changed files (the "Now" scope).
- **Commit history** — the branch/merge lane graph of commits on the run's own branch.
- **M / A / D** — the only file-state badges: `M` modified, `A` added, `D` deleted.
- **Viewer** — the single shared file view the tab opens for any listed file.
- **Empty state** — the "no worktree / not available" view shown when there is no readable Run checkout.
- **Durable snapshot** — a server-written capture of a run's changes and history under `output_root`, readable after the checkout is cleaned up (fast-follow; see FR-9).

## 4. Features

### 4.1 Source Control tab and layout

**Description:** A fourth tab, **Source Control**, on the workflow-run screen, shaped like VS Code's Source Control panel: a **Changes region** (uncommitted) above a **commit-history graph** region (branch/merge lane topology, like VS Code / GitLens), both scoped to the Run being viewed. Refresh is manual. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Source Control tab with two regions

An operator viewing a run can open a **Source Control** tab that shows, for that run, the **Changes region** above the **commit-history graph**.

**Consequences (testable):**

- The run screen exposes a fourth tab labelled Source Control beside Graph / Logs / Chat.
- Opening it on a run with an available Run checkout populates both regions from that run.
- Opening it on a run with no available Run checkout shows the Empty state (FR-8), not an error.

#### FR-2: Manual reload

The operator refreshes the tab's data on demand; the tab never auto-refreshes or polls.

**Consequences (testable):**

- A **Reload** control re-fetches the current region/file.
- No background polling of the Run checkout occurs.
- `[ASSUMPTION]` If content changed on the server since load, the tab offers a "changed — Reload" affordance rather than mutating the open view underneath the reader.

### 4.2 Changed-file listing

**Description:** For the selected scope — uncommitted (Now) and per selected commit — the tab lists which files changed, each badged with exactly one of `M`, `A`, or `D`. Realizes UJ-1.

**Functional Requirements:**

#### FR-3: List changed files as M / A / D

The operator sees the changed file paths for the selected scope, each labelled `M` (modified), `A` (added), or `D` (deleted).

**Consequences (testable):**

- The Now listing matches the run checkout's uncommitted changes; a commit's listing matches that commit's file set.
- Every entry carries exactly one of `M` / `A` / `D`.
- Other git statuses project onto these: rename → `D` (old path) + `A` (new path); copy → `A`; type-change → `M`; unmerged → `M`. (see `addendum.md`)

### 4.3 File viewer

**Description:** Clicking any file in either region opens one shared Viewer whose mode is keyed by status. `M` shows a two-pane diff (red = before, green = after); `A` shows the added file's content in a single pane; `D` shows the removed file's content in a single pane. Every file opens regardless of size or type. Realizes UJ-1.

**Functional Requirements:**

#### FR-4: Status-keyed diff viewer

The operator opens any listed file into the shared Viewer, rendered by status.

**Consequences (testable):**

- `M` → two-pane diff, red = before / green = after.
- `A` → single pane showing the new file's content, no diff coloring.
- `D` → single pane showing the removed file's content, no diff coloring.
- Diff direction: Now = `HEAD → worktree`; selected commit = `parent → commit`. (see `addendum.md`)
- `M` has no standalone snapshot mode in v1 — it is diff-only.

#### FR-5: Every file opens (large and binary)

The operator can open any changed file — large text or binary — without the Viewer blocking.

**Consequences (testable):**

- A multi-MB text file opens (streamed / chunked) rather than being refused.
- A binary file is not dumped as text: images render inline; other binaries offer download or a hex peek.
- Opening a file shows immediate feedback (metadata/skeleton) and can be cancelled. (thresholds in `addendum.md`, tunable)

### 4.4 History navigation

**Description:** The operator can click any commit in the history and inspect its files and diffs, read from the run's own branch — including commits not present on the base branch. The history is rendered as a **branch/merge commit-topology graph** (lanes assigned by topology — not one-per-branch), one row per commit. Realizes UJ-1.

**Functional Requirements:**

#### FR-6: Inspect any commit from the run checkout

The operator selects any commit in the history and sees its `M`/`A`/`D` files and their contents/diffs, read from the Run checkout's branch (not the base branch).

**Consequences (testable):**

- A commit on the run branch not yet merged into the base branch still shows its files and diffs.
- The commit view uses the same Viewer and the `parent → commit` direction.
- The history renders as a **lane graph** (branch/merge topology), one row per commit; this requires each commit's **parent OIDs** (`parents[]`) added to the existing log record (message / author / time). The lane-layout is a flagged build spike (see architecture).

### 4.5 Access and safety

**Description:** All reads are resolved on the server from `runId`, confined to that run's checkout, and strictly read-only. The client never supplies the checkout root or an absolute/filesystem path; it may pass a server-returned repo-relative path, which the server validates against the run's tree.

**Functional Requirements:**

#### FR-7: Server-resolved, run-confined, read-only access

The system serves Source Control data by resolving the run's checkout server-side from `runId`; no request reads outside that run's checkout and no write/commit path exists.

**Consequences (testable):**

- The UI sends `runId` + a server-returned reference (a repo-relative path chosen from the changes/commit list, or a commit ref) — never the checkout root or an absolute/filesystem path.
- The server resolves `working_path` from the run, realpaths it, and rejects any `..`.
- No endpoint mutates the checkout (no write, commit, or path-injection surface).

**Feature-specific NFRs:**

- Follows Archon security + package rules — git invoked with server-controlled args (no shell string), OpenAPI-registered routes, web consumes generated types only; specific APIs and package boundaries in `addendum.md`.

### 4.6 Graceful absence

**Description:** A Run checkout can be missing (cleaned up, never present, or not a git checkout). The tab degrades to a clear Empty state instead of failing.

**Functional Requirements:**

#### FR-8: Empty state for no readable checkout

When the run has no readable git checkout — `working_path` null, its directory absent at read time, or it is not a git checkout — the tab shows an explicit "no worktree / not available" Empty state.

**Consequences (testable):**

- A run whose checkout was cleaned up renders the Empty state, not an error/crash.
- A run with a null `working_path` renders the Empty state.
- Presence is decided by directory existence at read time, not by run status.
- A container-backend run (host path stale mid-run) renders the Empty state.

### 4.7 Durable history _(fast-follow, not v1)_

**Description:** After a run's checkout is cleaned up, its Source Control history and diffs can still load from a server-written Durable snapshot. The live checkout is the primary source while it exists; the snapshot is the fallback once it is gone.

**Functional Requirements:**

#### FR-9: Durable snapshot of a run's changes `[fast-follow]`

At run end, the server writes a Durable snapshot (changed files with status, per-file diffs, added/deleted content, and the commit log) under the run's `output_root`, surviving checkout cleanup.

**Consequences (testable):**

- After the checkout is reaped, the tab still loads that run's history and diffs, sourced from the snapshot.
- While the checkout exists, reads come from the live checkout; the snapshot is only the fallback.

**Notes:** `[NOTE FOR PM]` Snapshot trigger is **run-end** (decided); the stored wire format (a JSON manifest) is finalized at build (see §8, `addendum.md`).

## 5. Non-Goals (Explicit)

- Not an embedded IDE or a generic remote file browser.
- No edit, commit, or any write from the UI — strictly read-only.
- No auto-refresh or polling — refresh is manual.
- No full Explorer tree of unchanged files — only changed files appear.
- No standalone snapshot mode for `M` files — `M` is diff-only.
- No change view reconstructed from the workflow event stream — events are provenance hints only, never the authoritative change list.
- No Source Control for **container-backend** runs in v1 — the host `working_path` is stale mid-run; they render the Empty state.
- No secret redaction / denylist in v1 — see §Constraints and Guardrails and §8.

## 6. MVP Scope

### 6.1 In Scope

- Source Control tab + two-region layout (FR-1) with manual Reload (FR-2).
- Changed-file listing as `M`/`A`/`D` for Now and per commit (FR-3).
- Status-keyed Viewer (FR-4) that opens every file, large or binary (FR-5).
- History navigation from the Run checkout (FR-6).
- Server-resolved, run-confined, read-only access (FR-7).
- Graceful Empty state (FR-8).

### 6.2 Out of Scope for MVP

- **Durable snapshot (FR-9)** — fast-follow; live checkout covers the common case first.
- **Container-backend runs** — the host path is stale mid-run; reading the overlay (docker exec / overlay diff walk) is a later upgrade.
- **Secret redaction** — deferred with a recorded residual risk (see Constraints and Guardrails).
- **Deferred niceties** — Logs↔Source Control link, Graph node changed-files badge/filter, reuse of the Viewer as a HITL review surface, event provenance overlay, default-to-run-commit history, collapse-empty-Changes. `[NOTE FOR PM]` These shape v1 design (build the Viewer as a reusable component; keep the read model clean) even though they are not built in v1.

## 7. Success Metrics

**Primary**

- **SM-1**: Operators inspect a run's changed files and diffs from the UI without SSH or clone — measured by adoption (tab used on real runs) and task completion (operator confirms "what changed" without leaving the screen). Validates FR-1, FR-3, FR-4, FR-6. `[ASSUMPTION]` No hard numeric target (internal tool); observed via tab usage on real runs plus lightweight operator feedback.

**Counter-metrics (do not optimize)**

- **SM-C1**: No measurable regression to the run screen's responsiveness from adding the tab — do not trade run-screen performance for Source Control features. Counterbalances SM-1.
- **SM-C2**: Zero secret-exposure incidents attributable to the Viewer — do not chase "open every file" so hard that sensitive files are surfaced carelessly. Counterbalances FR-5.

## 8. Open Questions

1. **Checkout existence verification** — the on-disk presence of a Run checkout on the remote host was never `stat`'d during planning (no fs endpoint / SSH). Confirm the read-time existence check against the real host during implementation.
2. **Durable snapshot (FR-9) wire format** — exactly what the artifact stores (name-status, unified diffs, added/deleted content, full log) and the manifest shape. The trigger is fixed to run-end; only the format is open. Decide at build.
3. **Large-file chunk size and binary hex-peek threshold** — defaults recorded in `addendum.md`; confirm/tune at build.
4. **Secret handling revisit** — v1 defers redaction; define the trigger (an actual exposure, or a policy change) that would bring a redaction/denylist into scope.

## 9. Assumptions Index

- §2.2 / §4.7 / §6.2 — v1 excludes container-backend runs (host path stale); read-in-container is a later upgrade. _(confirmed)_
- §4.5 — access is any user who can view the run (open admin/member, single-tenant multi-user); no new per-tab restriction. _(confirmed)_
- §4.2 (FR-2) — a "changed — Reload" affordance is offered when server content diverges from the open view. _(inferred)_
- §6.2 / Constraints — v1 defers secret redaction and accepts the residual risk given read-only + trusted internal users. _(confirmed)_
- §7 (SM-1) — no hard numeric success target for an internal tool. _(confirmed)_
- Doc language — this PRD and addendum are authored in English per config `document_output_language`, though the originating brainstorm ran in Vietnamese. _(confirmed)_
- §Cross-Cutting NFRs (Observability) — server-side reads emit named structured logs (`{domain}.{action}_{state}`) and never log file contents, disallowed paths, or secrets. _(inferred)_
- §Rollout — ship v1 without a feature flag (read-only, low risk); add one only if a rollout concern emerges. _(inferred)_

---

## Cross-Cutting NFRs

- **Performance / latency:** Source Control fetches on click with explicit loading feedback; no hard SLA, but it must not regress the run screen (SM-C1). Large files stream; the tab never blocks the run screen. Reads are on-demand only (manual Reload; no polling).
- **Security:** server resolves the checkout root from `runId` (never client-supplied); the client may pass a server-returned repo-relative path, which the server realpaths and validates under the checkout, rejecting `..`; git is invoked with server-controlled args, never a shell string; strictly read-only. Mechanism (APIs, package boundaries) in `addendum.md`. (FR-7)
- **Reliability:** a vanished or missing checkout degrades to the Empty state, never a crash (FR-8); a terminal run status does not imply the checkout is gone — existence is checked at read time.
- **Compatibility:** honors Archon package boundaries and coding rules — OpenAPI-registered routes (with the raw-route exception the artifacts route uses for wildcard/non-JSON responses), web consumes generated types only, no SDK leakage across package boundaries. Specifics in `addendum.md`.
- **Observability:** `[ASSUMPTION]` server-side reads emit named structured logs in the existing `{domain}.{action}_{state}` style and never log file contents, paths beyond what policy allows, or secrets.
- **Accessibility:** the diff must not rely on color alone — each changed line carries a `+`/`-` gutter marker as the non-color cue (WCAG 1.4.1; the red/green tint is secondary); `M`/`A`/`D` badges are letter-carried; the Changes list, commit-history graph, and viewer are keyboard-operable; WCAG-AA contrast is verified for load-bearing tokens (diff markers ≥ 4.5:1, commit-graph lanes ≥ 3:1 non-text). The layout must reflow/zoom without loss (tested at 320px / 400%); the specific stack/unified behavior is a build `[ASSUMPTION]`. UX contract: `../ux-designs/ux-Archon-source-control-2026-08-31/EXPERIENCE.md` (Accessibility Floor).

## Constraints and Guardrails

- **Privacy / secrets (residual risk, v1):** the Viewer reads arbitrary files from the Run checkout, which can contain `.env`, keys, or tokens; v1 ships **without** redaction or a denylist. This is accepted because access is read-only and limited to trusted internal users who can already view the run, and adding a filter is a separate effort. The risk is recorded; revisit per §8.4 if an exposure surfaces or the trust boundary changes.
- **Read-only guarantee:** there is no write/commit/edit surface anywhere in the feature; this is a hard guardrail, not a default.
- **Cost:** on-demand reads and manual Reload cap server load; no continuous polling of remote checkouts.

## Integration and Dependencies

- **Run record:** depends on `GET /api/workflows/runs/{runId}` exposing `working_path` + `codebase_id` (already present; the web UI already reads `workingPath`).
- **New read-only git API:** none exists today; it is new, modeled on the existing artifact route pattern (server-side path resolution, `..` rejected). `@archon/git` currently exposes only a boolean `hasUncommittedChanges`. (contract + command mapping in `addendum.md`)
- **Web UI:** a new tab in the existing run screen; consumes OpenAPI-generated types.
- **Isolation lifecycle:** cleanup (conversation/PR close, scheduler, manual, codebase delete, orphan) can remove the checkout; the feature reacts by existence check, not by owning lifecycle. (see `addendum.md`)
- **Self-contained handoff:** this PRD + `addendum.md` carry all load-bearing product and technical context for an isolated Archon implementation agent; no parent-workspace files are required.

## Rollout

- **No feature flag** in v1 — the feature is read-only and low-risk. `[ASSUMPTION]` Ship directly; add a flag only if a rollout concern emerges.
- Standard Archon dev workflow (`dev` branch, PR template, `bun run validate`) applies.
