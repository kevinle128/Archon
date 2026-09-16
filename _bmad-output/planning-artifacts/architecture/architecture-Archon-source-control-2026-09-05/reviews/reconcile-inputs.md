# Reconcile — load-bearing inputs vs ARCHITECTURE-SPINE

**Spine:** `architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md`  
**Reviewed:** 2026-09-05  
**Method:** Diff every load-bearing constraint / tone / state / mechanism from the inputs against AD-1–AD-9, Consistency Conventions, Deferred, and the Capability map. Spine was **not** edited.  
**Note on UX input:** `ux-Archon-source-control-2026-09-05/EXPERIENCE.md` (and companions) were missing from disk at reconcile time (folder reduced to `imports/`). Content was recovered from the Finalize session transcript (`a83d6a8c…`, status: final) and cross-checked against the architecture memlog line “INHERITED UX final 2026-09-05: 30/70…”. SPEC/brownfield/viewer-rules and `plans/architectures/archon-source-control.md` were read from the parent workspace copies under `workflow-engine/`.

---

## Inputs checked

| Input                                               | Role                                                      |
| --------------------------------------------------- | --------------------------------------------------------- |
| `spec-archon-source-control/SPEC.md`                | CAP-1–8, Constraints, Non-goals                           |
| `…/brownfield.md`                                   | Path pin, lifecycle, security, events≠SoT, CAP-8 mechanic |
| `…/viewer-rules.md`                                 | Viewer modes, refresh, large/binary open strategy         |
| `ux-Archon-source-control-2026-09-05/EXPERIENCE.md` | States, Reload, 30/70, Voice & Tone, flows                |
| `plans/architectures/archon-source-control.md`      | D1–D6 (+ spikes, post-decision D6 corrections)            |

---

## What DID land (summary — not gaps)

| Input load-bearing                                                                                                       | Spine home              |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Read-only; UI never sends `working_path`; server resolves from `runId`                                                   | AD-1, AD-9              |
| Realpath + live realpath-contain; no `oid:path`; ls-tree -z + cat-file; colon/leading-dash/glob SUCCESS                  | AD-1 (+ Tests row)      |
| Git helpers in `@archon/git` via `execFileAsync`; thin routes                                                            | AD-2                    |
| JSON OpenAPI + raw wildcard content (artifacts precedent)                                                                | AD-3                    |
| Canonical hunk JSON + web adapter; A/D via raw; Now/commit directions                                                    | AD-4                    |
| `react-diff-view@3.3.3` + hljs + virtual; 30/70, resize 20–70%, independent diff panes, stack &lt;900px; reusable viewer | AD-5                    |
| Container gate via conversation→isolation_env provider; host = dir+git at read time; not run status                      | AD-6                    |
| Live git SoT; events hints only                                                                                          | AD-7                    |
| CAP-8 WorkflowDeps finalize seam; fail-open; idempotent; v1 no write                                                     | AD-8                    |
| Legacy tab only; manual Reload; no poll; no write chrome                                                                 | AD-9                    |
| Status set M/A/D + projections                                                                                           | Consistency Conventions |
| API error on live checkout ≠ CAP-6                                                                                       | Consistency Conventions |
| Secret redaction deferred; CAP-8 deferred; container overlay deferred; child env at build; large-diff spike              | Deferred                |

D1–D6 decisions map cleanly onto AD-2 / AD-3 / AD-5 / AD-8 / AD-6 / AD-1 respectively. No D-decision was reversed by the spine.

---

## What did NOT land (dropped / diluted)

### 1. Quiet requirement — Voice & Tone (EXPERIENCE) — **MATERIAL**

**Source:** EXPERIENCE §Voice and Tone

> Microcopy is terse, factual, and non-alarming — a diagnostic reporting a fact, never an error shouting. Empty and absence states explain _why the data isn't here_ in one plain sentence and stop.

Plus the Do/Don't table (“No files to show” vs “Error: working tree not found ⚠️”; container copy vs “unsupported”; “Changed on disk — Reload” vs auto-mutating the view).

**Spine:** No AD, Consistency row, or Capability note binds tone. CAP-6 map says only “server gate + UX copy” — ownership gesture, not the constraint. The AD structure dropped this quiet product requirement entirely.

**Why it matters:** Without it, implementers default to error chrome / alarm copy for CAP-6 and fetch failures, contradicting the primary flow climax (“the quiet nod”).

---

### 2. Stale-content affordance — never mutate the open view (viewer-rules + EXPERIENCE) — **MATERIAL**

**Source:** viewer-rules §Refresh; EXPERIENCE State “Stale content”; Interaction ban.

- Manual Reload (landed in AD-9).
- If host content diverged since load: surface **“Changed on disk — Reload”** (EXPERIENCE wording; viewer-rules: “changed — Reload”).
- **Never** mutate the open viewer underneath the reader.

**Spine:** AD-9 locks “Manual Reload only / no auto-refresh.” It does **not** lock the stale affordance or the no-mutate-under-reader rule. Consistency “error envelope + Reload” covers API failure, not silent host drift while a file stays open.

---

### 3. CAP-6 CTA differentiation (EXPERIENCE) — **MATERIAL**

**Source:** EXPERIENCE State Patterns + Empty-state component rule (“Reload CTA **only when a retry could help**”).

| Case                         | CTA                                      |
| ---------------------------- | ---------------------------------------- |
| Empty — container run        | **No** Reload (files aren't on the host) |
| Empty — no readable checkout | **With** Reload (transient / may appear) |

**Spine:** AD-6 collapses both into one CAP-6 gate. No AD distinguishes CTA policy. Easy to ship a single empty component that always (or never) shows Reload.

---

### 4. Viewer open-strategy thresholds & affordances (viewer-rules / CAP-7) — **MATERIAL (partial)**

**Source:** viewer-rules §Every file must open; EXPERIENCE Loading / Large / Binary / Flow 3.

Locked defaults (tunable at build):

- Skeleton first + **Cancel**; list/sizes from metadata immediately.
- Large text: first paint ~256 KB / ~2,000 lines; `M` hunks + 3 context; &gt;~1 MB stream with Cancel; &gt;~50 MB **download only**.
- Binary: NUL in first 8 KB; images inline; else download + ~4 KB hex peek.
- Nothing blocked — open or usable fallback.

**Spine:** AD-3/AD-4/AD-5/AD-7 cover ranges, cursor hunks, and virtualization. Deferred mentions only the ~2 MB first-paint spike for react-diff-view. The skeleton/Cancel/Load-more/download-only/image/hex contracts are absent from ADs — CAP-7 map reduces to “raw route ranges + cursor hunks + virtual,” which can satisfy “large” without satisfying “binary / cancel / download-only / never dump binary as text.”

---

### 5. Region-level empty states (EXPERIENCE) — **MATERIAL (UX state machine)**

**Source:** EXPERIENCE — Empty Changes; Empty History (Finalize add); distinct from whole-tab CAP-6.

- Checkout exists, zero uncommitted → Changes region message; History still visible.
- No commits yet → History region message; Changes still visible.

**Spine:** Only whole-tab CAP-6 (AD-6) and “API error … list remains.” No AD or convention for region-level emptiness. Risk: implementers treat “no changes” as CAP-6 or hide History incorrectly.

---

### 6. Accessibility floor for status/diff cues (EXPERIENCE) — **SOFT / BOUNDARY**

**Source:** EXPERIENCE Accessibility Floor — letter-carried `M`/`A`/`D`; `+`/`-` gutter markers (never color/tint alone).

**Spine:** Silent. Arguably UX-spine territory, but it is load-bearing for CAP-3 “red/green” fidelity under WCAG 1.4.1. Flagged so architecture/story-dev does not treat tint-only diffs as compliant.

---

### 7. Minor / intentional dilutions (not primary dropped list)

| Item                                            | Source              | Spine treatment                       | Verdict                           |
| ----------------------------------------------- | ------------------- | ------------------------------------- | --------------------------------- |
| CAP-8 write failure also “emit a metric”        | D4 correction       | AD-8: log, don’t fail run             | Metric dropped — minor            |
| Spike 2 (M-file vertical slice adapter)         | plans Spikes        | Only large-diff spike in Deferred     | Soft drop                         |
| In-checkout symlink SUCCESS test                | D6                  | Tests: escape refuse only             | Soft drop                         |
| Explicit “OID from log, hex + reachable”        | D6 post-decision    | AD-1 implies commit refs; not spelled | Soft drop                         |
| `codebase_id` as identity companion             | SPEC Constraints    | working_path-centric                  | Soft — usually implied by run row |
| Non-goal: no M snapshot mode / no Explorer tree | SPEC Non-goals      | Implicit via AD-4 / CAP-1             | Soft — OK if UX holds             |
| Loading (panel) skeleton rows                   | EXPERIENCE Finalize | Absent                                | Soft — pairs with #4              |

---

## Quiet-requirement callout (for hand-off)

The AD structure is strong on **mechanism** (containment, ports, transport, viewer stack, gates) and weak on **operator-facing quiet constraints**:

1. **Tone:** diagnostic, non-alarming, one-sentence absence reasons.
2. **Stale view:** tell the reader to Reload; do not rewrite the open pane.
3. **CTA honesty:** Reload only when retry can help (container vs missing checkout).

Those three are the highest-risk silent losses for story-dev if the spine is treated as the sole build substrate.

---

## Recommendation (notes only — spine untouched)

If a follow-up AD pass is authorized, prefer a single thin **AD-10 (Operator-facing quiet rules)** binding (1)–(3) above, plus a Consistency row pointing CAP-7 at viewer-rules thresholds (or “defaults live in viewer-rules; spine owns that they are mandatory”). Do not fold tone into CAP-6 alone — it applies to API-error and stale states too.

---

## Dropped items — short list

1. Voice & Tone quiet constraint (terse / non-alarming / one-sentence absence)
2. “Changed on disk — Reload” + never mutate open view
3. CAP-6 Reload CTA split (container: none; missing checkout: yes)
4. Viewer open strategy (skeleton/Cancel/Load more/download-only/binary/hex thresholds)
5. Region-level Empty Changes / Empty History
6. (Soft) Diff `+`/`-` / letter badges as non-color a11y floor  
   )
