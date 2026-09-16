---
review: accessibility
lens: WCAG 2.2 AA floor
target: [DESIGN.md, EXPERIENCE.md]
reviewer: A11yReview
created: 2026-08-31
verdict: PASS-WITH-MINOR-GAPS
---

# Accessibility Review — Archon Source Control tab

Scope: the a11y FLOOR for a READ-ONLY, run-scoped git inspector that inherits the
Archon shadcn/Radix WCAG-AA design system. This review validates the spine pair; it
does not edit it. Method: assess each load-bearing WCAG 2.2 AA criterion, then
separate a genuine floor GAP (missing / contradictory / load-bearing-unspecified)
from an acceptable deferred `[ASSUMPTION]`/`[OPEN]` (correctly flagged, direction
sound, non-blocking).

Severity = downstream a11y impact if shipped as-is, not fix difficulty.

## Ground truth used

- Sources carry **zero** a11y statements — keyboard, focus, ARIA, colour-blind
  alternatives are all originated by the distill, not the specs
  [.working/source-extract.md §15,73; §51-55].
- The diff **`+`/`-` gutter markers are the LOCKED WCAG-1.4.1 floor**; the red/green
  tint is `[ASSUMPTION]` and the markers satisfy the floor **with or without it**
  [.memlog #44 superseded by #47; DESIGN §89; EXPERIENCE §109].
- Everything else "inherits Archon shadcn/Radix WCAG-AA defaults for contrast, focus
  rings, and dialog semantics" [EXPERIENCE §114].

## Per-criterion verdicts

### 1.4.1 Use of Color (AA) — PASS

- Diff: `+`/`-` gutter markers are the confirmed non-colour cue and are explicitly
  **not defeated if the tint is dropped** — both spines state the markers stand alone
  [DESIGN §87-89, Do/Don'ts §135; EXPERIENCE §109]. Verified robust to tint removal.
- Badges: `M`/`A`/`D` meaning is carried by the **letter**, never colour; tint is
  "decorative reinforcement only" [DESIGN §90, §122, `status-badge.rule`; EXPERIENCE
  §60, §110]. Verified.
- No other state (loading skeleton, binary, empty) encodes meaning by colour.
- Residual: the `[OPEN]` "changed — Reload" divergence affordance is unspecified in
  form; noted so it is not later built as a colour-only signal. Not a gap today.

### 1.4.3 Contrast — Minimum (AA) — PARTIAL (1 medium)

- The load-bearing combo is the **`+`/`-` gutter marker** — it is the sole 1.4.1 cue,
  so its legibility is safety-critical. `diff-added-gutter` / `diff-added-bg` are
  **net-new tokens** ("no shadcn default green", bound at build) [DESIGN colors §19,21,
  §88]. **No contrast target is stated** for the marker glyph on its line background
  (tinted or untinted). "Inherits AA defaults" does not cover a token that does not yet
  exist. See **A11Y-1**.
- Dimmed path text (`path-dim` = inherited `typography.muted` / muted-foreground) and
  the badge letter (`foreground` on `muted`) ride **pure inheritance** from the Archon
  system — in-scope only as inheritance, acceptable at floor level.

### 1.4.10 Reflow (AA) / 1.4.4 Resize Text (AA) — PARTIAL (1 medium)

- The two-pane diff sits inside a `react-resizable-panels` split (left panel ↔ right
  viewer) [DESIGN §105]. **No statement** describes behavior at 320px CSS width / 400%
  zoom: whether the left panel + right viewer **stack** or force whole-app horizontal
  scroll, and whether the side-by-side diff panes reflow or invoke the 1.4.10
  code-block 2D-exception. Responsive/density is `[DELEGATED]` to Archon [EXPERIENCE
  §125], but the two-pane diff is an SC-specific surface the system default may not
  cover. See **A11Y-2**.

### 1.4.11 Non-text Contrast (AA) — PARTIAL (1 low, deferred-note)

- Commit-graph **lane dots + connecting lines** are graphical objects that convey
  topology (which lane, which merge) — they need ≥3:1 vs the panel background. Lane
  colour lives in the graph renderer, which is a flagged `[ASSUMPTION]` + medium-risk
  **spike** [EXPERIENCE §98,103; DESIGN §58,123]. Deferring the value is acceptable;
  the **requirement** should be attached to the spike's acceptance. See **A11Y-3**.
- Focus rings inherit the Archon `ring` token (AA) — acceptable by inheritance.

### 2.1.1 Keyboard (A) — PASS (1 low note)

- The floor (everything operable) IS specified: Changes list, commit graph rows,
  inline-expanded files, viewer scroll, expand/collapse, Load-more, Cancel are all
  keyboard-focusable and operable; Reload is a standard shadcn button [EXPERIENCE
  §111; DESIGN §127]. Operability is guaranteed independent of the exact keys.
- Specific key bindings are `[OPEN]` → Archon web conventions. **Deferring the keys is
  acceptable** because operability is asserted as a contract, not left to chance.
- Note: the **resize handle** keyboard operability is unstated (react-resizable-panels
  supports arrow-key resize). Non-blocking — a default ratio exists and reflow gives an
  alternative — but should be confirmed. See **A11Y-5**.

### 2.4.3 Focus Order + focus management (A) — PARTIAL (1 low)

- Tab order = reading order (Changes → Graph → viewer) is stated as a **behavioral
  contract**, not an assumption [EXPERIENCE §111] — floor met for static order.
- Focus MANAGEMENT on dynamic change is `[ASSUMPTION]` [EXPERIENCE §112]. The
  direction is correct (open→focus into viewer; empty→focus to message/CTA;
  collapse→return to originating row). The one load-bearing case is the **empty state
  replacing the whole panel** [DESIGN §126; EXPERIENCE §65]: if the previously focused
  element is removed, focus can be orphaned to `<body>`. The proposed mitigation is
  right but unconfirmed. See **A11Y-4**.

### 4.1.2 Name, Role, Value (A) — PASS

- File rows announce **path + status** ("`M`, modified" — letter mapped to a word, so
  SR meaning does not rely on the visual glyph); commit rows announce
  message + **expanded/collapsed** (implies `aria-expanded`); the viewer region
  announces its **mode** (diff vs single pane) [EXPERIENCE §113]. Requirements captured.
- Roles ride Radix primitives for used parts (Button, Tabs, resizable, dialog for
  empty-state card) — correct name/role/value by construction. Adequate at floor level.

## Findings

| ID     | WCAG           | Severity   | Finding                                                                                                                                                                                               | Fix                                                                                                                                                                                                   |
| ------ | -------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11Y-1 | 1.4.3          | **medium** | No contrast target for the `+`/`-` gutter markers — the sole 1.4.1 cue — on their line bg; `diff-added-gutter`/`diff-added-bg` are net-new build-bound green tokens with no default and no guardrail. | State **≥4.5:1** for the gutter glyphs on both tinted and untinted line bg; add "marker contrast verified" to the build acceptance for the green token binding.                                       |
| A11Y-2 | 1.4.10 / 1.4.4 | **medium** | No reflow/zoom statement for the left-panel + two-pane diff split at 320px / 400%.                                                                                                                    | Specify panel behavior at narrow width (stack, or single active pane); if using the 1.4.10 code-block 2D-scroll exception for diff content, state it explicitly; confirm no loss of content/function. |
| A11Y-3 | 1.4.11         | low        | Commit-graph lane dots/lines convey topology with no ≥3:1 contrast target (deferred with the renderer spike).                                                                                         | Attach **≥3:1 lane/dot vs panel bg** to the graph-spike a11y acceptance; not a v1 blocker.                                                                                                            |
| A11Y-4 | 2.4.3          | low        | Empty-state whole-panel replacement can orphan focus; focus management is `[ASSUMPTION]`.                                                                                                             | Promote **empty-state + viewer-swap** focus handling from assumption to floor (move focus to message/CTA; return on collapse); keep exact key bindings deferred.                                      |
| A11Y-5 | 2.1.1          | low        | Resize-handle keyboard operability unstated.                                                                                                                                                          | Confirm the handle exposes keyboard resize + an accessible name/role; non-blocking.                                                                                                                   |

## Acceptable deferred assumptions (NOT gaps)

- **Specific key bindings** `[OPEN]` — 2.1.1 operability is asserted as a contract; the
  keys correctly defer to Archon conventions.
- **Diff line tint** `[ASSUMPTION]` — 1.4.1 is satisfied by the markers alone; the tint
  is decorative and its absence changes nothing at floor.
- **Dark mode / density / motion / i18n** `[DELEGATED]` — genuinely inherited from the
  Archon system; no SC-specific delta, appropriately deferred.
- **Panel split ratio / row heights** `[ASSUMPTION]` — no a11y impact at floor.

## Overall

**PASS WITH MINOR GAPS.** The accessibility floor is fundamentally sound: the one
load-bearing, SC-specific a11y decision — the 1.4.1 diff cue — is correctly locked and
verified robust to tint removal, badges are letter-carried, keyboard operability and
name/role/value are asserted as contracts, and the genuinely absent-from-source items
are honestly flagged rather than fabricated. No critical or high gaps. The two medium
items are **specification** gaps (a contrast target for the net-new diff-marker token,
and a reflow/zoom statement for the two-pane diff) rather than design defects; the three
low items harden dynamic focus, graphic contrast, and resize. None block finalize.

Severity: critical 0 · high 0 · medium 2 · low 3.
