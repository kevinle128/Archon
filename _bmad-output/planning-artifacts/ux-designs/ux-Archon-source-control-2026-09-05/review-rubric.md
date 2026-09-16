# Spine Pair Review — Archon Source Control (legacy UI)

## Overall verdict

The spine pair is fit for downstream consumption with four focused fixes needed before architecture hand-off. The core contract is well-formed: inheritance discipline is correctly applied throughout (no fabricated hex, no SPEC restatement, all token refs resolve), state patterns cover the primary lifecycle edge cases, and the Do's/Don'ts table is directly implementable. The primary gaps are concentrated in two areas: (1) the large-file/binary/streaming surface (CAP-7, viewer-rules "Load more" / "Cancel" / hex peek / download) has behavioral coverage in the state table but no key flow and no DESIGN visual specs for its two components; and (2) the initial panel-load state for the Changes and History regions is undocumented — the state table covers viewer loading but not left-panel fetch-on-open. These are solvable without structural revision.

---

## 1. Flow coverage — **adequate**

**Checked:** EXPERIENCE.md § Key Flows against SPEC CAP-1 through CAP-8 + viewer-rules.

Flow 1 — "Did it touch what I think?" covers CAP-1, CAP-2, CAP-3, CAP-4 with a named protagonist (Tú), six numbered steps, and an explicit climax beat. Flow 2 — "The vanishing checkout" covers CAP-6 with a named protagonist, three numbered steps, and a clear resolution (empty state, no crash). Both are well-formed.

### Findings

- **high** CAP-7 (large text / binary / streaming) has no key flow. The state table covers Large text, Very large, and Binary rows, and EXPERIENCE.md Component Patterns covers "Load more" and "Cancel" — but there is no flow narrating what the operator experiences when they click a 10 MB file: skeleton → chunked stream → "Load more" or download fallback. This is a non-trivial UX path that an implementation engineer or story-writer needs to picture end-to-end. _Fix:_ Add Flow 3 — "Opening a large or binary file" with a protagonist, numbered steps through skeleton → stream → Load more / download / hex peek, and the cancel path.

- **medium** Flow 1 has no failure path. The rubric requires one "where applicable" — an API error mid-diff-load (git command failure, timeout, or server 5xx) is applicable on the primary flow. _Fix:_ Append a step 7 to Flow 1: "If the diff fetch fails, the viewer shows an inline error with a Reload CTA; the file list remains visible and other files remain selectable."

---

## 2. Token completeness — **strong**

**Checked:** All frontmatter tokens in DESIGN.md; all `{path.to.token}` references in both prose and frontmatter; inheritance claims against packages/web/src/index.css declarations.

Eight delta color tokens defined as semantic references to inherited Archon palette tokens (`{colors.error}`, `{colors.success}`, `{colors.warning}`, `{colors.muted}`, `{colors.surface}`, `{colors.surface-hover}`, `{colors.text-primary}`, `{colors.text-secondary}`). All inherited tokens named in the comment block are confirmed Archon dark-theme conventions. The semantic references are correct delta-discipline — no fabricated hex demanded. All `{path.to.token}` references in prose and frontmatter resolve to defined tokens (delta or inherited). Spacing and rounded correctly declare inheritance with named deltas only.

### Findings

- **medium** `typography.commit-meta` reads `'size-down, {colors.text-secondary} — author + relative time [ASSUMPTION]'`. "Size-down" is relative to an unspecified baseline — an engineer cannot implement this without guessing. The `file-row` entry is better (`0.8125rem class`) even though it's also an assumption. _Fix:_ Replace "size-down" with a concrete size reference, e.g. `0.75rem` (`text-xs` in Tailwind) or `note: 'text-xs / {colors.text-secondary}'` — then mark [ASSUMPTION] on the size if needed.

- **low** Diff tint alpha values are `[ASSUMPTION: bind at build]` with no reference range. Not critical (the assumption is correctly flagged and the downstream engineer is told where to bind), but no guidance on expected perceptual alpha (e.g., 15–20% for diff backgrounds is conventional). A hint in the note would prevent a build-time guess. _Fix:_ Add a parenthetical in the frontmatter comment: `(expected ~15–20% alpha — adjust for WCAG contrast)`.

---

## 3. Component coverage — **thin**

**Checked:** All component names in DESIGN.md frontmatter `components:`, DESIGN.md body, EXPERIENCE.md Component Patterns table, EXPERIENCE.md State Patterns.

DESIGN.md defines 7 components: `changes-row`, `status-badge`, `commit-row`, `viewer-diff`, `viewer-single`, `empty-state`, `reload-button`.

EXPERIENCE.md Component Patterns table lists 9: Changes row, Status badge, Commit row, Viewer — diff, Viewer — single, Reload, Empty state, **Load more**, **Cancel**.

### Findings

- **high** `Load more` — behavioral spec in EXPERIENCE.md (first paint ~256 KB / ~2,000 lines; streams with "Load more"), no visual spec in DESIGN.md. An implementer needs to know: button or inline affordance? Where does it sit — below the content, sticky? What tokens (color, typography, spacing)? _Fix:_ Add `load-more` to DESIGN.md `components:` with `bg`, `fg`, `note` (e.g., inline text button, `{colors.text-secondary}` label, appears at stream boundary).

- **high** `Cancel` — behavioral spec in EXPERIENCE.md (aborts in-flight load; offered on streams > ~1 MB; keyboard-reachable; announces via `aria-live`), no visual spec in DESIGN.md. _Fix:_ Add `cancel` to DESIGN.md `components:` with placement, token refs, and accessibility note.

---

## 4. State coverage — **adequate**

**Checked:** EXPERIENCE.md State Patterns table against every IA surface (Changes region, History region, Viewer, whole-tab, left-panel initial).

State Patterns cover 10 states: Populated, Empty Changes, Empty — container run, Empty — no readable checkout, Loading (viewer), Stale content, Large text, Very large, Binary, Worktree gone mid-view. All sourced and marked with CTA rules where applicable.

### Findings

- **high** No initial-load state for the Changes and History regions. The State Patterns table covers viewer loading ("File clicked, bytes arriving") but not the state when the tab first opens and the Changes list is being fetched from the API. The Foundation mentions "fetch-on-click with explicit loading feedback" in the context of performance, but does not describe what renders in the left panel while the status/log API calls are in flight. Does the Changes region show a skeleton? A spinner? A placeholder row? An implementer cannot answer this from the spine. _Fix:_ Add a "Loading (panel)" row to State Patterns: `Trigger: Tab opened or Reload clicked; Treatment: Changes + History regions show skeleton rows (count inherited from shadcn skeleton convention); Viewer empty.`

- **high** No API / git-command error state. CAP-6 covers the "no readable checkout" empty state (which is a data-layer condition), but there is no state for when the checkout exists and is valid, yet a git command fails (e.g., git not found, permission denied, timeout, 5xx from the new read-only API). The operator would see… nothing? An error? A toast? _Fix:_ Add an "API error" row: `Trigger: git API returns a non-404 error; Treatment: Inline error in the relevant region with a Reload CTA; source the error display pattern from the Archon design system (shadcn toast or inline Alert).`

- **low** No history-region empty state. What renders in the History region for a run that has made no commits yet on its branch (e.g., a run that only modified uncommitted files)? The State Patterns cover "Empty Changes" but not "Empty History." _Fix:_ Add "Empty History" row: `No commits yet on the run branch → region shows "No commits yet" [ASSUMPTION copy]; Changes region stays visible.`

---

## 5. Visual reference coverage — **thin**

**Checked:** `mockups/`, `wireframes/`, `imports/` directories (none exist); `.working/` directory (one file: `key-screen-source-control-2026-09-05.html`); inline links in both spines.

The key-screen mock exists at `.working/key-screen-source-control-2026-09-05.html` and was user-accepted per the memlog ("ok roi do"; locked: 30/70 split, drag-resize, two-pane diff, 900px collapse). Neither spine links to it. No `mockups/`, `wireframes/`, or `imports/` directory exists — the mock has not been promoted.

### Findings

- **medium** Mock not promoted and not linked. The memlog records three user-confirmed visual decisions that are now load-bearing for downstream architecture (panel split default 30/70; drag-resize range 20–70%; two-pane M-diff with independent horizontal scroll; 900px collapse behavior). These decisions appear in the spines as text, but the implemented mock that proved them is orphaned in `.working/`. A consumer — especially an AI story-writer — cannot visually verify the split ratio, the stacking behavior, or the diff pane scroll without finding and opening the mock independently. _Fix:_ Promote `key-screen-source-control-2026-09-05.html` to `mockups/` and link it from EXPERIENCE.md § Information Architecture and § Responsive & Platform with a one-line caption ("Key screen: populated state with M diff open, 30/70 split, 900px collapse").

---

## 6. Bloat & overspecification — **strong**

DESIGN.md is lean and correct for a delta spine: frontmatter carries tokens, prose sections carry editorial voice and rationale, the Components body section is a forward pointer only (no redundant anatomy). No pixel specs where tokens cover it. No source restatement.

EXPERIENCE.md carries no decorative narrative. The Open Questions & Assumptions table is practical (it's the assumption register, not filler). The Responsive & Platform section is triggered (memlog locked the 900px decision) and concise. Voice and Tone table is actionable. No findings.

---

## 7. Inheritance discipline — **adequate**

**Checked:** `sources` frontmatter resolves; UJ/requirement names consistent; glossary across spines and sources; component names across all sections; EXPERIENCE.md token refs.

Both spines list identical `sources:` frontmatter (5 files, all confirmed to exist). SPEC CAP references are cited inline with `[SPEC CAP-N]` markers consistently. No source restatement beyond what contextualizes the spec. Glossary terms "Changes", "History", "Viewer", M/A/D are consistent across both spines and the SPEC bundle.

EXPERIENCE.md does not use `{path.to.token}` references (by design — it describes behavior, not visual appearance). This passes trivially; no broken cross-refs.

### Findings

- **medium** `Load more` and `Cancel` appear in EXPERIENCE.md Component Patterns with no counterpart in DESIGN.md `components:`. This is a broken inheritance link — EXPERIENCE.md is specifying behavioral rules for components the DESIGN.md does not acknowledge. _Fix:_ Add the missing entries to DESIGN.md (see §3 above).

- **low** Naming mismatch: DESIGN.md frontmatter uses `reload-button`; EXPERIENCE.md Component Patterns table uses `Reload`. The semantic difference (`-button` qualifier) could confuse a consumer doing a mechanical name-match. _Fix:_ Align to `Reload` in both (the button qualifier is implicit from the component role).

- **low** EXPERIENCE.md Component Patterns cites "inline-expand [ASSUMPTION]" for Commit row behavior, but the Open Questions & Assumptions table (item 2) reads "Commit row interaction: inline expand/collapse [ASSUMPTION]." These are consistent, but the OQ&A table is the canonical register — the inline tag is redundant noise. _Fix:_ In the Component Patterns table, cite [OQ-2] instead of repeating [ASSUMPTION] inline for the assumption already registered.

---

## 8. Shape fit — **strong**

**DESIGN.md canonical order check:** Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts — all eight sections present, order correct. ✓

**EXPERIENCE.md required defaults:** Foundation ✓ · Information Architecture ✓ · Voice and Tone ✓ · Component Patterns ✓ · State Patterns ✓ · Interaction Primitives ✓ · Accessibility Floor ✓ · Key Flows ✓

**Required-when-applicable:**

- **Inspiration:** VS Code Source Control is cited in the SPEC ("in the shape of VS Code's Source Control panel") and in architecture-diagrams ("VS Code SCM style"). It is a source-document reference, not a reject, so the Inspiration section is not strictly triggered under the rubric; the reference is accessible to consumers via the SPEC. Marginally defensible to omit — but noting it here for completeness.
- **Responsive:** Present ✓ — triggered by the memlog-locked 900px decision.

**Invented sections:** "Open Questions & Assumptions" earns its place as the explicit assumption register. No findings.

---

## Mechanical notes

- **Cross-ref:** `Load more` and `Cancel` exist in EXPERIENCE.md Component Patterns but not in DESIGN.md `components:`. Broken link; not a name drift — the entries are absent. (See §3, §7.)
- **Name drift:** `reload-button` (DESIGN.md frontmatter) ↔ `Reload` (EXPERIENCE.md table). Minor. (See §7.)
- **Mock promotion:** `.working/key-screen-source-control-2026-09-05.html` has no corresponding entry in `mockups/` and no inline link from either spine. (See §5.)
- **Frontmatter completeness:** Both spines carry `status: draft` — correct for a pre-finalize artifact.
- **Architecture-diagrams.md:** Three Mermaid diagrams (Tab layout, Read request resolution, Truth model, Diff direction) — syntax valid, no broken refs. EXPERIENCE.md cites `architecture-diagrams` as a source for IA decisions; the diagrams confirm the master-detail layout and the server-side resolution model. No issues.
- **Viewer-rules.md:** All viewer thresholds appear in the EXPERIENCE.md State Patterns and Component Patterns rows verbatim; cited as `[viewer-rules]`. No drift.
- **OQ&A register:** Ten items, all flagged [ASSUMPTION] or [ASSUMPTION — source context]. Items are correctly registered without silently inventing defaults. Item 10 (HITL viewer reuse) is a design-bending note from roadmap.md — appropriate to carry here.
