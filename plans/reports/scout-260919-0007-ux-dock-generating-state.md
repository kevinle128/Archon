# Scout: UX/Design Requirements for Steering Composer Dock — `generating` State (Story 2.1)

**Source:** Design, architecture, and spec artifacts for Archon agent node room steering (CAP-8..CAP-13, formerly CAP-1..CAP-6)
**Date:** 2026-09-19
**Target:** Story 2.1 "Queue guidance for a running agent" — the dock in `generating` state only (when agent is working)

---

## 1. Exact Copy for the Generating State

### Send Button Label
- **"Queue"** while the agent is generating (EXPERIENCE.md, line 131; DESIGN.md, line 634)
- **Fixed box, size, and position** — when the label changes between `Queue` and `Send now`, the box width holds to the wider of the two labels (`min-width: 84px`), so the control does not move (DESIGN.md, line 342; README.md, line 342)

### Stop Button Label  
- **"Stop"** while the agent is generating (EXPERIENCE.md, line 132; DESIGN.md, line 638)
- Reads `Stopping…` (a brief optimistic transient, sub-second) **only** while the interrupt is in flight (EXPERIENCE.md, line 172; DESIGN.md, line 639)

### Draft Box Header
- **"QUEUED · n"** (with count) while the agent is generating (DESIGN.md, line 645; README.md, line 306; EXPERIENCE.md, line 133)
- Uppercase, phase-label typography (`10px`, `letter-spacing: 0.07em`) (DESIGN.md, lines 88–91, 505–512; README.md, line 264)

### Unsent Draft Label
- **"this tab only"** — labelling the **unsent composer draft only** (the `QUEUED` band header carries no scope label; a queued message is server-side once pressed, CAP-8/CAP-9) (README.md, line 314; EXPERIENCE.md, line 181)

### Keyboard Hint Text
- **`Cmd`/`Ctrl`+`Enter` to send** (EXPERIENCE.md, line 202; README.md, line 389)
- Displayed on the send control's accessible name and as a composer hint (EXPERIENCE.md, line 199)

### Placeholder Text (Composer Field)
- Not explicitly specified in the provided docs. Treat as standard "Type your message…" or equivalent; inherits `placeholder-legacy` / `placeholder-console` token (DESIGN.md, lines 316–317)

### Detached-Run Dock State (Disclosure, if applicable to generating state)
- **This dock state 8 belongs to a finished/non-steerable run, NOT the generating state**
- The docs explicitly separate it (README.md, delta 4; EXPERIENCE.md, State Patterns, finished/detached rows are separate)
- **Not in Story 2.1 scope** — generating state is CAP-8: "Compose while the agent works" with active Send/Stop controls

### Per-Item Actions While Generating
- Keep and delete buttons on queued messages only
- **Delete is Story 2.2**; Story 2.1 must include keep and delete **controls present but functional** (Story 2.1 → 2.2 escalation)
- **No per-item "Send now" in v1 generating state** — it is spike-gated on soft-inject (claude streaming input) and absent from the v1 floor (README.md, delta 2; SPEC.md, line 130)
- Keep and delete: **present and enabled** in generating state (DESIGN.md, line 651; EXPERIENCE.md, line 134)

---

## 2. Blocked/Pending-Ask Rule: Send Control When AskHuman/Permission Exists

### Send Control Behavior When Pending Ask
- **`aria-disabled`** (never the native `disabled` attribute, which would unfocus it) (EXPERIENCE.md, line 178; DESIGN.md, line 636; review-accessibility-steering.md, line 155)

### Reason Text
- **"answer the agent's question first"** (EXPERIENCE.md, line 178; Voice & Tone, line 94)
- Associated with the Send control via **`aria-describedby`** — adjacent text is not enough; screen readers require the association (EXPERIENCE.md, line 178; review-accessibility-steering.md, lines 229–230)

### Keyboard Shortcut Guard  
- **`Cmd`/`Ctrl`+`Enter` is gated by the same `aria-disabled` condition as the button click path** (review-accessibility-steering.md, lines 205–214; EXPERIENCE.md, line 202 + SPEC.md constraints)
- Plain `Enter` inserts a newline and never sends (EXPERIENCE.md, line 130)

### Node State When Blocked
- Node stays `running`; the pending ask is the blocker, not a lifecycle change (EXPERIENCE.md, line 178)
- "No live session in the steering registry" — CAP-not-steerable-here, narrowly scoped to this node only (SPEC.md, 'not steerable here')

---

## 3. Accessibility Rules Binding the Generating State

### Live-Region Announcements
- **One shared polite region** (`role="status"`) for all dock state changes (not two competing regions) (EXPERIENCE.md, line 241; review-accessibility-steering.md, lines 79–80)
- **Announcements are serialized, not priority-ordered** — coincident writes coalesce into one composite per transition, steering state last (review-accessibility-steering.md, lines 107–110)
- **Sub-state announcements carry their consequence:** `agent idle · Send now delivers` (review-accessibility-steering.md, line 142)
- **Polite (not assertive)** except for delivery-failed-back-to-queue, which is `role="alert"` / assertive (review-accessibility-steering.md, lines 293)

### Focus Management
- **Focus never moves to `<body>`** (DESIGN.md, line 175; EXPERIENCE.md, line 248)
- On dock state transitions, focus landing on a just-renamed control (e.g., `Queue` → `Send now`) triggers the AT to announce the new label (EXPERIENCE.md, line 249)
- **Both shells use the same focus token** — `--accent-bright` opaque (DESIGN.md, lines 495–501; README.md, line 396)

### Color-Free Status Glyph (Message Status)
- **Words, never dots or color alone:** `sent` (text-secondary) and `delivered` (success colour _in addition to_ the word) (DESIGN.md, lines 624–625; EXPERIENCE.md, line 128)

### Reduced Motion
- **Dock introduces no animation** in the generating state (field growth / composition is deferred; stop disclosure and draft box appearance happen **without** animation where applicable); if animation is added, gate it under `prefers-reduced-motion` (review-accessibility-steering.md, lines 216–221)

### Minimum Target Sizes (SC 2.5.8)
- Send/Stop controls: **32px** `min-height` (DESIGN.md, line 324; README.md, line 341)
- Draft-item keep/delete: **24×24px** (grown on padding) (DESIGN.md, line 380; README.md, line 320)
- Composer field: **56px** `min-height` (DESIGN.md, line 308; README.md, line 338)

### Contrast (SC 1.4.3, 1.4.11)
- Send control label (text-primary): **14.1:1 Legacy / 16.7:1 Console** (DESIGN.md, line 478)
- Composer placeholder (text-secondary): **6.3:1 Legacy / 8.9:1 Console** (DESIGN.md, line 475)
- Composer typed text (text-primary): **16.5:1 Legacy / 18.8:1 Console** (DESIGN.md, line 476)
- Draft item text (text-secondary): **6.3:1 Legacy / 8.9:1 Console** (DESIGN.md, line 477)
- Dock focus ring (SC 1.4.11): **6.8:1 Legacy / 4.6:1 Console** (DESIGN.md, line 481)

---

## 4. Layout and Tokens

### Dock Placement
- **Pinned to the bottom of the node panel** — one fixed dock shared by both surfaces (EXPERIENCE.md, line 128; DESIGN.md, line 627)
- Pinned todo strip at the **top** of the panel (first child immediately above transcript scroller) (README.md, page 200; CAP-3)
- Transcript scroller scrolls behind dock (SC 2.4.11) (README.md, line 195)

### Panel Widths
- **Legacy: 460px** — the width to verify against (DESIGN.md, line 537; README.md, line 213)
- **Console: 520px** — the mock's own choice; both surfaces adapt the same row anatomy (DESIGN.md, line 537; README.md, line 182)

### Typography  
- **Mono labels:** send/stop control, draft item ordinal, queue band header word (DESIGN.md, lines 61–64, 506; README.md, lines 264, 320)
- **Sans (prose):** composer field, operator row, assistant text — set in the same face/size the text will be read at (12.5px sans with 1.55 line height) (DESIGN.md, lines 305–307; README.md, line 338)
- **Control labels (send/stop):** weight 500, 11.5px (DESIGN.md, line 100, 321, 344)

### Brand Token Set  
All values from existing tokens; **no new token introduced:**
- `--surface-elevated` dock background (DESIGN.md, line 300)
- `--surface-inset` composer field, draft box background (DESIGN.md, lines 310, 365)
- `--border` top edge, dividers (DESIGN.md, lines 302, 313)
- `--border-bright` send/stop control edges (DESIGN.md, lines 326, 349)
- `--text-primary` send/stop labels, operator prose (DESIGN.md, lines 328, 351, 286)
- `--text-secondary` composer placeholder, draft item, labels (DESIGN.md, lines 316, 383, 289)
- `--accent-bright` focus ring (2px outline) (DESIGN.md, lines 330, 354, 496)
- Blocked send control dims to `text-secondary` only (not tertiary) when `aria-disabled` (DESIGN.md, lines 341–342; review-accessibility-steering.md, line 190)

### Two-Renderer Boundary  
- Console must not import from `@/components/` — dock JSX is written twice, thin (EXPERIENCE.md, line 35; DESIGN.md, line 4; SPEC.md, line 113)
- Shared logic in `packages/web/src/lib/` (README.md, line 488)

### Spacing & Rounded
- Dock padding: **8px 10px** (DESIGN.md, line 298)
- Dock gap (children): **6px** (DESIGN.md, line 299)
- Composer field, send/stop controls: **6px radius** (DESIGN.md, lines 309, 323, 346)
- Draft item: **4px radius** (DESIGN.md, line 381)

---

## 5. Message Status Model at v1 Floor

### Status Lifecycle
- **Draft → `sent` only; never `delivered` at v1 pin** (SPEC.md, line 130; DESIGN.md, lines 292–296)
- `delivered` is **unreachable** at SDK ≥ 0.3.209 (SPEC.md, line 106; README.md, line 369; ARCHITECTURE-SPINE.md, line 209)
- `sent` badge: **text-secondary** (DESIGN.md, line 293)
- `delivered` badge (post-v1, claude only): **success colour in addition to the word** (DESIGN.md, line 295)

### Glyph/Badge
- **Word only, never a dot:** the row carries the **text** `sent` or `delivered`, never a bare coloured dot (DESIGN.md, lines 624–625; Voice & Tone, line 90)

---

## 6. Capability & Architecture Definitions (Verbatim or Tight Paraphrase)

### CAP-8 — Compose while the agent works
> An operator watching a running node can write a message without disturbing it. The composer is mounted and enabled while the node runs, and the send control reads `Queue`. Sending holds the message; the node is untouched, no tool call is interrupted and nothing is lost. The message is delivered as the next turn when the current turn ends naturally. (SPEC.md, lines 84–86)

### CAP-9 — Interrupt the agent's thinking; the node keeps running
> An interrupt control in the node's composer dock ends the agent's **current turn** — via the provider's own primitive (claude `interrupt()`) or a stream-abort — and the **provider session stays alive**. The **node stays `running`** throughout (its agent moves to a projected `idle-after-interrupt` sub-state). (SPEC.md, lines 88–90)

### CAP-12 v1 Floor — Mid-turn delivery, as fast as each provider's transport allows
> The operator's message reaches a running agent without interrupting it (when using `Queue`). Sending to a running agent is an **ordinary prompt**, not a separate steer primitive. `Queue` (the default, on every provider) delivers it as the next turn at the natural boundary, non-interrupting. (SPEC.md, lines 100–102)

### NFR4 — Accessibility (WCAG 2.2 AA floor)
> Accessibility rules bind the node room; specific rules for steering: `aria-disabled` over `disabled`, no colour-encoding of status alone, live-region announcements serialized, focus never to `<body>`, contrast 4.5:1 on all text 10–12px, target size 32px minimum for controls. (review-accessibility-steering.md; DESIGN.md, measured section; EXPERIENCE.md, Accessibility Floor)

### NFR8 — WCAG 2.2 AA conformance (mandatory)
> Every dock surface is measured for contrast; no text under 4.5:1; status glyphs and badges are words, never colours alone; reduced motion respected (where animation is added). (DESIGN.md, lines 456–489; review-accessibility-steering.md)

### UX-DR4 — User Decision: Bordered Send Control, Not Filled
> The send control is bordered on both shells (transparent fill, border-bright edge, text-primary label). A filled button (shadcn ask-card style) measures 3.1:1 Legacy, a failure for 11.5px. Bordered measures 14.1:1 / 16.7:1. Primacy is carried by position (right edge), not fill. (DESIGN.md, lines 332–336; review-accessibility-steering.md, line 489)

### UX-DR7 — Control Box Stability
> Send control box, size, and position are held fixed across `Queue` ↔ `Send now` label change. A control that moves or resizes is two controls; operator pointer is already travelling to the first one. (DESIGN.md, line 635; EXPERIENCE.md, line 131)

### UX-DR8 — Stop Control is `aria-disabled` in Transient State
> `Stopping…` is `aria-disabled`, never the native `disabled` attribute. The native attribute blurs focus to `<body>`, moving the entire document away. `aria-disabled` keeps focus on the control; the dim floor is text-secondary (5.3:1), not shadcn tertiary (2.3:1). (DESIGN.md, line 636; EXPERIENCE.md, line 172)

### AD-9 — Projected Sub-State Inside `running`
> The agent's state **inside** `node = running` is projected in the core with **exactly two values:** `generating` (turn streaming, interruptible) and `idle-after-interrupt` (interrupted, awaiting operator). `interrupting` is a UI-local transient, never projected. Both shells read this one sub-state. (ARCHITECTURE-SPINE.md, AD-9, lines 159–161)

### AD-11 — Send and Interrupt Routes; Actor Grant
> Send and Interrupt are new routes (`POST …/send`, `…/interrupt`), resolving identity via `resolveAuthContext`. The steering-specific actor grant (owner-ratified): any **authenticated** identity may send/interrupt a running node, each request attributed by `operator_user_id`. The registry queue absorbs races; only a finished node refuses (409). (ARCHITECTURE-SPINE.md, AD-11, lines 169–179)

---

## 7. Explicit Non-Goals / Story 2.1 Must NOT Do

### From SPEC.md Constraints (Write Half)
- **No durable steering state** — no marker, no phase, no CAS, no attempt-key. In-process registry only. (SPEC.md, line 131)
- **No per-item send while generating** — there is nothing an individual message could do but wait. Queueing-only in v1; soft-inject is spike-gated. (EXPERIENCE.md, line 134; README.md, delta 2)
- **No soft-inject in v1** — mid-turn delivery without interrupt is claude-streaming-input spike-gated and post-v1. (SPEC.md, line 130)
- **No auto-drain, no auto-send mode** — every send stays operator-initiated. (README.md, line 37)
- **No node pause or resume** — the node stays `running` throughout; `pause` and `resume` are Cancel-lifecycle terms, not steering terms. (SPEC.md, line 131; ARCHITECTURE-SPINE.md, AD-1, line 100)
- **The dock must not appear on a finished node** — field and both controls are absent when the node is no longer `running`. (EXPERIENCE.md, line 138)

### From README.md Deltas (Deliberate Design Choices)
- **No per-item send while generating** — only keep/delete until soft-inject lands (delta 2; post-v1 G2) (README.md, line 88)
- **No durable queue before Send** — typed text is client-side draft, but pressing `Queue` makes it server-side in the registry (README.md, line 135)
- **No new `delivered` state in v1** — only `sent`; `delivered` needs SDK ≥ 0.3.246 (post-v1 G1) (README.md, line 369)

### From EXPERIENCE.md State Patterns (v1 Boundary)
- **No "turn-start" event from steering** — the turn boundary is the agent's own loop's; steering must not emit a phantom one (EXPERIENCE.md, line 140; ARCHITECTURE-SPINE.md, AD-7)
- **No silent delivery** — if a `Queue` message is unmatched on terminal, it returns to draft as "Never sent" (EXPERIENCE.md, line 181)
- **No client-dispatch at the drain moment** — the message enters the server registry on `Queue`-press, not when the executor drains it (ARCHITECTURE-SPINE.md, AD-11, line 174)

---

## Summary

**The generating state dock is the first story:** send (`Queue`) and interrupt (`Stop`) on a running agent, with the operator's composition happening in real time. The dock must:

1. **Display exact labels** (`Queue`, `Stop`, `QUEUED · n`) in phase-label uppercase on the band header
2. **Show keyboard hint** on send control for `Cmd`/`Ctrl`+`Enter` 
3. **Block send on pending ask** with accessible reason text (`aria-describedby`)
4. **Keep stop/send controls at opposite edges** to prevent thumb collision
5. **Hold send control's box size** stable across label change
6. **Respect all contrast, focus, and motion-reduction rules** — codified in DESIGN.md measured tables and review-accessibility-steering.md
7. **Never appear on non-running nodes** — generating state is `running` only
8. **Not implement per-item send, soft-inject, or auto-drain** — v1 scope is queue + interrupt
9. **Mark messages `sent`, never `delivered`** — confirmation waits for SDK bump (post-v1)

No durable queue, no node pause, no run pause. The agent stays in the same session; the operator's correction joins the next turn.

---

**Status:** DONE
**Summary:** Extracted exact UX copy, accessibility rules, layout specs, brand tokens, and capability/architecture definitions for Story 2.1 (generating state dock) from five canonical artifacts (DESIGN.md, EXPERIENCE.md, SPEC.md, ARCHITECTURE-SPINE.md, README.md). All measurements, tokens, and label text are verbatim or tight paraphrase with precise citations.
**Concerns/Blockers:** None — the specification is complete and ratified (owner-confirmed 2026-09-15, per ARCHITECTURE-SPINE.md review).

