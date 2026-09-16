---
review: rubric-walker (bmad-ux finalize gate)
lens: rubric / shape-fit / mechanical-coverage
target: DESIGN.md + EXPERIENCE.md
reviewer: RubricReview-2
date: 2026-08-31
mode: validate-only (spines NOT modified)
---

# Rubric Review — Archon Source Control spine pair

## Overall verdict: **PASS** (sound downstream contract)

No critical or high findings. The spine pair is coherent, canonically shaped, fully cross-resolved, and honest about what is decided vs. assumed. It is safe to hand to architecture / story-dev as the UX contract. **One medium fix** is recommended before `status: final` (link the wireframe + state the spines-win-on-conflict rule); the rest are low-severity polish. Properly-flagged `[ASSUMPTION]`/`[OPEN]`/`[RISK]` items are treated as acceptable, per gate rules — they are not counted as defects.

---

## PASS 1 — Mechanical coverage

### 1. Flow coverage — **STRONG** (no misses)

The source set defines exactly **one** user journey: UJ-1, protagonist **Kevin** [source-extract §Foundation; prd.md §2.3:43-44]. It is fully realized in `EXPERIENCE.md § Key Flow`:

- Named protagonist — **Kevin** [EXPERIENCE.md:132].
- Numbered steps — 1–7 [EXPERIENCE.md:134-140].
- Climax beat — explicitly labelled at step 7 ("answered the question entirely from the run screen, without SSHing/cloning") [EXPERIENCE.md:140].
- Failure path — the "Failure branch" covers checkout-cleaned-up → _No worktree available_ + Reload, and container → _No files to show_ + no CTA [EXPERIENCE.md:142].
  Every FR maps to a flow beat or a State/Interaction row (FR-2 Reload → step 6; FR-4 diff → step 4; FR-6 commit graph → steps 3,5; FR-8 Empty → failure branch). No requirement is orphaned.
  **Fix:** none.

### 2. Token completeness — **STRONG** (all resolve)

Every frontmatter token in `DESIGN.md` (`colors.diff-*`, `colors.badge-*-fg`, `typography.code|region-header|path-dim`, `rounded.inherit`, `spacing.commit-row-height|file-row-height|panel-split-default`, `components.*`) is referenced or self-contained. Every `{path.to.token}` reference resolves:

- `EXPERIENCE.md` → DESIGN: `{spacing.panel-split-default}` [EXPERIENCE.md:28], `{spacing.commit-row-height}` [:101], all 7 `{components.*}` rows [:59-65], `{colors.diff-added-bg}`/`{colors.diff-removed-bg}` [:62,109] — all present in DESIGN frontmatter.
- `DESIGN.md` internal: `{typography.path-dim}` [:121], `{colors.badge-*-fg}` [:54], `{colors.diff-*-gutter}`/`{colors.diff-*-bg}` [:87-88,124] — all present.
- Inherited-by-reference (`{colors.destructive}`, `{colors.foreground}`, `{colors.background}`, `{rounded.inherit}`) resolve to the Archon system **by design** — not dangling [DESIGN.md:11-17,75].
- The single genuinely-unbound token is the **known `[OPEN]` diff-green** `{colors.diff-added-bg}` (shadcn has no default green semantic) — explicitly flagged in DESIGN Colors + Open Questions [DESIGN.md:19,88; EXPERIENCE.md:126]. Per gate rules this is acceptable, not a defect.
  **Fix:** none. (Only close the `[OPEN]` diff-green at build.)

### 3. Component coverage — **STRONG** (7/7 in both, identical names)

Every component has a visual row in `DESIGN.md § Components` **and** a behavioral row in `EXPERIENCE.md § Component Patterns`, with byte-identical names:

| Component          | DESIGN.md (visual) | EXPERIENCE.md (behavioral) |
| ------------------ | ------------------ | -------------------------- |
| `changes-row`      | :121               | :59                        |
| `status-badge`     | :122               | :60                        |
| `commit-graph-row` | :123               | :61                        |
| `viewer-diff`      | :124               | :62                        |
| `viewer-single`    | :125               | :63                        |
| `reload`           | :127               | :64                        |
| `empty-state`      | :126               | :65                        |

Standard shadcn parts (Button, Skeleton, Tabs, resizable panels) are correctly declared "used as-is" and excluded from the delta spec [DESIGN.md:119]. No orphan on either side.
**Fix:** none.

### 4. State coverage — **ADEQUATE**

Walking the three IA surfaces (Changes region, Graph region, shared Viewer), the required state classes are all present in `EXPERIENCE.md § State Patterns`:

- **empty** — two distinct triggers: container-run (no CTA) and no-readable-checkout (Reload CTA) [:71-72]; plus **Empty Changes** (checkout exists, zero uncommitted) [:76].
- **loading** — viewer skeleton + Cancel; list/sizes from metadata [:73].
- **error** — transient fetch + server security refusal [:78] (client-side copy flagged `[OPEN]`, acceptable).
- **large** — Load-more paging / stream / download-only tiers [:74].
- **binary** — NUL-sniff → inline image / hex-peek + download [:75].
- **mid-loss** — mid-view checkout loss re-routes to no-readable-checkout Empty [:77].
- **Miss (LOW):** no explicit **initial region-load** state for the Changes/Graph _lists themselves_ on tab open — the skeleton row [:73] is scoped to the _viewer_ only, and DESIGN names shadcn `Skeleton` "as-is" [DESIGN.md:119] without a tabled state. For long-history graph fetch/pagination this is only implied via the `[ASSUMPTION/TBD]` virtualization note [EXPERIENCE.md:101]. Downstream story-dev must infer the first-paint state of the left panel.
  **Fix:** add a State Patterns row — _"Region initial load → left-panel Skeleton rows until metadata resolves"_ — or one sentence in IA confirming the lists paint instantly from cached run metadata (no skeleton needed).

### 5. Visual reference coverage — **THIN** (the one real miss)

- `imports/vscode-source-control-reference.md` **is** linked inline, repeatedly and in context [DESIGN.md:79,81,104; EXPERIENCE.md:22,98]. ✓
- `wireframes/flow-source-control-v1-refined-2026-08-31.{excalidraw,png}` **exists** (verified on disk) and was promoted per `.memlog:46`, but is **not referenced inline from either spine**. ✗
- **No "spines win on conflict" statement** appears in either document. ✗
  The reference shape (see `experience-example-shadcn.md:29`) is an explicit composition pointer plus the conflict rule: _"→ Composition reference: … Spine wins on conflict."_ Its absence means a downstream consumer has no in-document path to the approved layout wireframe and no stated precedence when the wireframe and the prose disagree. **Severity: MEDIUM** — the artifact exists but is unwired, and the precedence rule that protects the spine as the contract is missing.
  **Fix:** add to `EXPERIENCE.md § Information Architecture` (and optionally `DESIGN.md § Layout & Spacing`):
  `→ Composition reference: wireframes/flow-source-control-v1-refined-2026-08-31.excalidraw (+ .png). The spines win on conflict.`

---

## PASS 2 — Judgment

### 6. Bloat / overspecification — **STRONG**

Lean and load-bearing. Every row carries a citation to a decision (`.memlog`), a spec line (`prd/arch/addendum/epics`), or an explicit assumption flag. No invented palette, type scale, radius, or component. Provisional values (split ratio, row height, renderer, tint) are correctly demoted to `[ASSUMPTION]` rather than fabricated [DESIGN.md:43,45,58; `.memlog:48`].

- **Minor note (LOW):** the tint-vs-marker WCAG caveat is restated ~4× across both spines (DESIGN Colors + Do/Don't + EXPERIENCE Accessibility + Open Questions). Defensible for a LOCKED a11y floor, but one canonical statement + cross-refs would tighten it.
  **Fix:** optional — collapse the repeated tint caveat to a single source-of-truth line.

### 7. Inheritance discipline — **STRONG**

- All four frontmatter `sources` resolve on disk (`prd.md`, `architecture.md`, `addendum.md` under `../../prds/prd-source-control/`, `epics.md` under `../../epics-source-control/`). ✓
- Glossary/vocabulary identical across both spines: region names (**Changes** / **Graph**), status set (**M/A/D**, untracked→A projection), viewer modes (two-pane / single-pane), diff direction (`HEAD→worktree` / `parent→commit`). No drift.
- All EXPERIENCE `{...}` refs resolve into DESIGN frontmatter (verified in §2). `EXPERIENCE.md` correctly delegates all visual identity to `DESIGN.md` and pins its `design: ./DESIGN.md` link [:5].
- Inheritance is stated as a discipline, not a gap — "inherit every Archon token not in the delta list" [DESIGN.md:133].
  **Fix:** none.

### 8. Shape fit — **ADEQUATE**

- **DESIGN.md canonical order — PASS (exact):** Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts [DESIGN.md:77-139]. Matches `design-md-spec.md § Body sections` order precisely.
- **EXPERIENCE.md required sections — PRESENT:** Foundation, Information Architecture, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flow — all present.
- **Invented sections earn their place:** `Commit Graph` is a genuine normative UX delta (history-as-topology-graph) with its `[RISK]` spike honestly flagged [EXPERIENCE.md:94-103] — justified. `Open Questions & Assumptions` is the honest-flagging ledger the whole distill relies on — justified. `Interaction Primitives` mirrors the example shape.
- **Miss (LOW):** `DESIGN.md` frontmatter omits the spec-**Required** `name` and the `description` key [`design-md-spec.md:13-14`; cf. `design-example-shadcn.md:2-3`]. The identity is carried by the H1 title and the `inherits:` key, so nothing downstream breaks, but the machine-readable contract is technically incomplete.
- **Note (not a defect):** no `Responsive & Platform` section — acceptable omission; the feature is a desktop-first tab inside an existing run screen and no source states a responsive requirement [source-extract §51-55].
  **Fix:** add `name: Archon Source Control` and a one-line `description:` to `DESIGN.md` frontmatter.

---

## Mechanical notes

- Spines were **not modified** (validate-only gate).
- Frontmatter `sources` (4) all exist on disk; `design:` back-link resolves; `imports/` + `wireframes/` targets exist.
- Cross-reference integrity: 100% of `{path.to.token}` refs resolve; the only unbound token is the declared `[OPEN]` diff-green.
- Component name parity: 7/7 exact match across both spines.
- FR coverage: FR-1…FR-8 all realized; FR-9 correctly parked as out-of-v1 `[OPEN]`.
- Known-acceptable flags (NOT counted as defects): split ratio, row height, independent scroll, graph renderer, diff tint, focus specifics, keyboard bindings, error/refusal client copy, empty-Changes copy, snapshot indication — all explicitly `[ASSUMPTION]`/`[OPEN]`; commit-graph lane algorithm carries a `[RISK]` spike flag.

## Severity counts

- Critical: **0**
- High: **0**
- Medium: **1** (§5 wireframe not linked inline + no spines-win-on-conflict rule)
- Low: **3** (§4 initial region-load state untabled; §8 missing frontmatter `name`/`description`; §6 repeated tint caveat)
