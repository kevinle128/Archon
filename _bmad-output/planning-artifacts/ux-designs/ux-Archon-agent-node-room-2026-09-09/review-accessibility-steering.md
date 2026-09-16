# Accessibility review — live agent steering (WCAG 2.2 AA)

Reviewer Gate, accessibility lens. Advisory only — nothing here modifies a spine or a mockup.
Judged against the spines (they win on conflict): `EXPERIENCE.md`, `DESIGN.md`,
`../../../specs/spec-agent-node-room/sources/spec-live-agent-steering/control-states.md`. The mockup is refreshing concurrently and is not judged.

**This file was overwritten after the reframe** ("clean in-session interrupt": `Stop` interrupts the agent, the node stays `running`,
whole-node teardown is the separate Cancel button). Findings are against the current spines.

## Verdict

The steering half is unusually strong on accessibility — the dock's own subsection (`EXPERIENCE.md` 237-255) and the
measured dock contrast table (`DESIGN.md` 471-483) pre-answer most of what this lens exists to catch. The gaps that remain
are the ones the reframe **added**: a new terminal state (the 30-minute idle-fail) and a new announcement collision, neither
fully carried through to its accessibility consequence.

**2 HIGH · 5 MEDIUM · 2 LOW · 0 critical.** Status: DONE_WITH_CONCERNS.
The single concern worth the gate: the reframe introduced a hard timing limit (30-min idle-fail) with **no SC 2.2.1 mechanism**,
and the spines do not see it as a timing SC at all.

---

## SC 1.4.1 — Use of Color

Every steering status channel carries a non-colour signal. Clean across all four.

- **`sent` / `delivered`** — PASS. They are _words_, never a dot or a hue; `delivered` adds the success colour _on top of_
  the word (`EXPERIENCE.md` 128, 246; `DESIGN.md` 620-621). This is the same rule the status glyph follows.
- **`interrupted` tool glyph** — PASS. `⚠` is a distinct fifth _character_, colour added on top (`EXPERIENCE.md` 219, 428).
  The Legacy shell collision (`⚠` amber == `--node-bash` chip amber, `DESIGN.md` 433) is glyph-vs-chip, not status-by-colour;
  the shape still separates them. Recorded, not a finding.
- **Agent sub-state** (generating | interrupting | idle-after-interrupt) — PASS. Signalled entirely by text: the control
  _labels_ (`Stop`/`Stopping…`/absent, `Queue`/`Send now`) and the draft-box header word (`QUEUED`/`WILL SEND`/`NEVER SENT`).
  No hue carries the sub-state.
- **Blocked by a pending ask** — PASS. The reason is visible text (`answer the agent's question first`, `EXPERIENCE.md` 178),
  not a bare dimmed control. The dim is a lightness cue, the text is the load-bearing one. (Its _contrast_ is a separate
  finding — see SC 1.4.3 below.)

The hardest case — operator row vs assistant row — is also colour-free: the `operator`/`assistant` role **label** is text,
independent of the text-strength difference (`EXPERIENCE.md` 247; `DESIGN.md` 617). A reader who resolves no colour still
reads the label.

---

## SC 2.2.1 — Timing Adjustable · **HIGH** (beyond the brief; the biggest finding)

**The 30-minute idle-fail is a content-imposed time limit with no warning, no extend, and no way to turn it off.**

Location: `EXPERIENCE.md` 174 (State Patterns → "Interrupt with no redirect (30-minute fail)"); the idle-after-interrupt
treatment 173; `control-states.md` table row 3 and §"Send now needs no server gate" (72).

After an interrupt, the node sits at idle-after-interrupt; if the operator sends nothing, the **engine fails the node after
30 minutes** (`interrupted by operator, no redirect received`). Nothing in the dock says a clock is running. The stop
disclosure (`stopped after the last completed tool call · files already written stay written`, 173/642) names what the
interrupt _did_ but never that the operator is _on a deadline to respond_.

SC 2.2.1 (Level A, therefore inside AA) requires one of: turn the limit off, adjust it, or **extend** it — extend meaning a
warning before expiry with at least 20 seconds and a simple action to get more time. None is present. The 20-hour and
"essential" exceptions do not apply: the spine's own rationale (never wait-forever, never a quiet finish on partial output,
`EXPERIENCE.md` 174) justifies having _a_ timeout — it does not justify the _absence of a warning_ before it fires.

This lands squarely on the population 2.2.1 protects: a screen-reader or motor-impaired operator composing a careful
correction slowly is exactly who runs out the clock.

**Fix (additive — keep the owner-ratified 30 minutes, add the mechanism):**

- Emit a polite announcement **and** a visible dock line at ~25 min: `node fails in 5 min without a redirect`.
- Give one simple action to extend, **or** make any keystroke in the composer / a `Send now` reset the clock and _say so_ in
  the disclosure line. Resetting-on-activity is the lightest 2.2.1-conformant answer and fits the dock's existing "follows
  the agent's sub-state" grain.
- This does **not** re-elicit the 30-minute value — it is owner-ratified and stays. The finding is that a ratified limit
  still owes users a warning path.

---

## SC 4.1.3 — Status Messages

The four dock changes that happen without moving focus each get the polite `role="status"` region, and the three agent
sub-state transitions reuse the same region rather than a competing one (`EXPERIENCE.md` 241-242). That baseline is correct.
Two real gaps sit on top of it.

### 4.1.3-A · Collision enforcement is a policy, not a mechanism — and it is three writes, not two · **HIGH**

Location: `EXPERIENCE.md` 232 (the single polite region + the Flow-4 climax collision); Flow 4 370-371, 377.

Line 232 correctly models the hazard — a polite region written twice in quick succession **drops the first message** — and
sets a resolution: _the steering message wins_. Three problems the reframe's own sub-second timing exposes:

1. **It is three writes in ~1 second, not the two line 232 names.** The interrupt is sub-second (`EXPERIENCE.md` 172, Flow 4
   370), so `agent interrupting` → `agent idle` already collide; add the transcript-half `⚠ interrupted` tool-row write and
   there are three writes racing for one region within a second. Line 232 reasons about two.
2. **"Steering wins" is a priority, not an ordering guarantee.** With `aria-live="polite"`, the message that actually
   survives is the one written **last** in the tick (AT-dependent). To make the steering message win, the implementation
   must _serialize_ — write the steering message last, or suppress the transcript `interrupted` announcement when it
   coincides with a sub-state announcement. Written naively in DOM/processing order, the transcript write may land second and
   `agent idle` — the one that tells the operator a control just changed meaning — is the one dropped. The opposite of
   intended, silently.
3. **No total order among steering messages, and that endangers the must-not-miss one.** Line 241 itself flags
   delivery-failed-back-to-queue as the message that must not be missed ("an operator who pressed `Send now` and heard
   nothing will press it again"), yet it lives in the _same_ polite region as the sub-state announcements. "Steering > transcript"
   does not disambiguate steering-vs-steering. A delivery-failure announcement can be dropped by a coinciding sub-state write.

Also: the auto-drain race (`EXPERIENCE.md` 176; Flow 4 377) is `agent interrupting` → `sent`×N (241 announces each) →
`agent generating`, all inside a second — the operator who pressed Stop hears at best `agent generating` and must _infer_
their queue drained.

**Fix:**

- State an explicit **serialization rule**, not just a priority: coincident writes are coalesced into one announcement, with
  the steering state written last.
- Prefer **one composite announcement per transition** over several racing ones: `turn ended before stop · 2 sent · agent generating`;
  `agent idle · 2 will send`.
- Give the delivery-failure message a **stronger channel** — `role="alert"` / assertive — or an explicit guarantee it is never
  coalesced away, since the spine already calls it must-not-miss.
- When `Stopping…` is not rendered (a product-owner option, 172), do **not** announce `agent interrupting` either — announce
  only the state the operator can actually catch up to (`agent idle`).

### 4.1.3-B · The 30-minute idle-fail's dock announcement is under-specified · **MEDIUM**

Location: `EXPERIENCE.md` 174 vs the natural-finish path 175 vs the dock SC 4.1.3 enumeration 241.

Not silent — line 232's region "announces node-level transitions and **failures**," so a `implement node failed` announcement
should fire for the node status. But three consistency gaps:

- The dock's own SC 4.1.3 list (241) enumerates four messages and **omits this one**, so a builder implementing "the four
  dock announcements" plus the natural-finish line (175) can silently skip it.
- The announcement copy does not distinguish _operator-caused, no redirect_ from a crash or a normal completion — three very
  different meanings.
- The dock-consequence — queue dies, unmatched `sent` → `NEVER SENT` read-only — is given the explicit treatment on the
  **natural-finish** path (`node finished · these never left this tab`, 175) but not on the 30-min-fail path (174 only says
  "resolves to its finished-node treatment").

**Fix:** add the 30-min-fail to the dock's announced messages with distinct copy, announced once, e.g.
`node failed · interrupted with no redirect · these never left this tab`. Give it the same focus + read-only-box treatment 175
already spells out (see Focus below).

### 4.1.3-C · `agent idle` does not say what line 242 says it exists to say · **LOW-MEDIUM**

Line 242's rationale for announcing the sub-state is that "a name that changes under a reader who is not looking at it is not
an event" — i.e. the _control changed meaning_. But `agent idle` names the **agent**, not the control. Focus moves to
`Send now` only if focus was on `Stop` (248); a reader parked in the transcript hears `agent idle` and learns nothing about
Send. **Fix:** carry the consequence in the copy — `agent idle · Send now delivers` — so the one announcement does the job
line 242 assigns it.

**Clean within 4.1.3:** the four enumerated dock messages (241) and the single-region reuse decision over a competing second
region (242) are the right calls; keep them.

---

## Focus management (SC 2.4.3, 3.2.1/3.2.2)

Strong, and the dangerous cases are the ones the spine already found.

- **`aria-disabled` vs the native `disabled` attribute** — STRONG PASS. The spine understands precisely that the native
  attribute blurs the element to `<body>` (then Tab restarts at document top), and mandates `aria-disabled` with a suppressed
  handler for `Stopping…` (`EXPERIENCE.md` 132, 172, 248, 250; `DESIGN.md` 636) and for the pending-ask-blocked Send (178).
- **Focus when the dock is removed on node finish** — PASS. Moves to the last transcript row, never `<body>` (175); at
  stopping→stopped the unmounting `Stop` hands focus to the send control (248).
- **Focus on the renamed control** — PASS. Focus landing on the just-renamed `Queue`→`Send now` triggers the AT to announce
  `Send now`, and the strengthened dock focus ring (6.8:1 / 4.6:1, `DESIGN.md` 481) covers the low-vision case (249).

**Carried into finding SC 2.2.1 / 4.1.3-B:** the 30-min-fail unmounts the field + controls (174). If the operator is present
with focus in the composer (typed but did not send), the finished-node focus move (175) must apply here too — otherwise focus
falls to `<body>`, the exact bug 175 exists to prevent. 174 does not restate the mitigation. Low added severity because the
premise is operator-absent, but it must inherit 175's focus rule explicitly.

---

## Contrast (SC 1.4.3, 1.4.11)

Every changed dock surface is measured, not inherited — `DESIGN.md` 471-483. All clear their floor:
send/stop label 14.1:1 / 16.7:1 (472-473), `Stopping…` 5.3:1 / 7.9:1 (474), composer placeholder 6.3:1 / 8.9:1 (475), typed
text 16.5:1 / 18.8:1 (476), draft item 6.3:1 / 8.9:1 (477), `delivered` 6.3:1 / 9.5:1 (478), `sent` 5.8:1 / 8.4:1 (479),
operator prose 15.3:1 / 17.7:1 (480), dock focus ring 6.8:1 / 4.6:1 for SC 1.4.11 (481). The `border-bright` edge at
1.5:1 / 1.6:1 (482) is correctly dispositioned — SC 1.4.11 asks for what _identifies_ the control, and the 14.1:1 label does
that; the border is redundant reinforcement (487). The rejected filled-button 3.1:1 (483) is not shipped.

**One gap the spine's own logic implies but leaves open:**

### The pending-ask-blocked Send has no dim-floor token · **MEDIUM**

Location: `EXPERIENCE.md` 178; `DESIGN.md` `send-control` block 320-336 vs `stop-control` block 337-353.

The blocked Send is `aria-disabled`, not natively `disabled` (178) — so, exactly like `Stopping…` (250, 636), it **forfeits
SC 1.4.3's inactive-component exemption** and its label must clear 4.5:1. The `stop-control` block pins the `Stopping…` dim
floor to text-secondary (`stopping-legacy`/`stopping-console`, 349-353, 5.3:1 / 7.9:1). The `send-control` block (320-336)
declares **no blocked-state token at all.** If a builder dims the blocked Send to the shadcn/`aria-disabled` convention
(text-tertiary → 2.3:1 / 3.9:1), it fails. The asymmetry between the two component blocks is the tell.

**Fix:** add a `blocked`/`aria-disabled` dim floor to `send-control` pinned to text-secondary, mirroring `stop-control`'s
`stopping-*`.

---

## Keyboard + reduced motion (SC 2.1.1, 2.5.8, 2.3.3)

- **`Enter`-to-send suppression** — STRONG PASS. `Enter` inserts a newline; send is a control press or `Cmd`/`Ctrl`+`Enter`,
  because "a stray `Enter` must not reach a running agent" (`EXPERIENCE.md` 130, 202). The shortcut is stated on the send
  control's accessible name and as a composer hint (202) — discoverable, not folklore.
- **Tab order = reading order** — PASS. Draft items → field → stop → send (208), matching visual top-to-bottom and the
  control row's left→right (stop left, send right).
- **Target size (SC 2.5.8)** — PASS. Dock controls 32px (`DESIGN.md` 126, 324, 341); composer 56px min (125); draft-item
  keep/delete at the 24×24 minimum grown on padding (251; `DESIGN.md` 374). All at or above the floor.

### The `Cmd`/`Ctrl`+`Enter` shortcut must honour the same aria-disabled guards as the click path · **MEDIUM**

Location: `EXPERIENCE.md` 202 (the shortcut) vs 178 (blocked-by-ask) and 248 (Stopping… suppressed handler).

The spine specifies a **suppressed handler** for the `Stopping…` _button_ (248) but says nothing about the keyboard shortcut
across the disabled states. If the `Cmd`/`Ctrl`+`Enter` keydown handler does not check the same state, a keyboard operator can
send while `Stopping…`, or send to a node parked at an ask (178) — bypassing the block the click path refuses. Keyboard paths
are exactly where these guards get forgotten.
**Fix:** state that the send keyboard shortcut is gated by the same condition as the Send control's aria-disabled state
(no-op while Stopping… and while blocked by a pending ask).

### Reduced motion is stated for the transcript, not the dock · **LOW**

`EXPERIENCE.md` 231 disables the 120ms chevron rotation under `prefers-reduced-motion` and calls it "the transcript's only
animation." The dock's own motion — draft box appearing, the field growing (252, 271), the `Stopping…` transient — is not
addressed. **Fix:** one line either way — state the dock introduces no animation (so the chevron rule is the whole
`prefers-reduced-motion` story), or gate whatever it adds. Prevents a builder adding a slide-in that ignores the preference.

---

## Screen-reader labelling (SC 4.1.2, 2.5.3)

Strong. The engineered-name discipline the transcript uses (221-223) carries into the dock:

- **Blocked-Send reason via `aria-describedby`** — STRONG PASS. Explicitly associated with the control, with the exact reason
  that adjacent text is "not a reason a screen reader will reach" (`EXPERIENCE.md` 178, 241). This is the correct mechanism.
- **Composer field has a real label, not a placeholder**, naming the node it writes to — PASS (244).
- **Draft box is a labelled list**, name carries count + mode (`Queued messages, 2` / `Will send, 2` / `Never sent, 2`), each
  item a list item — PASS (245). Note the SR name is sentence-case while the visual is uppercase — correct.
- **Queue depth rides the send control's accessible name** (`Queue message, 2 waiting`) while a control exists, and moves to
  the read-only list's name on a finished node where no control is left — PASS (243).
- **Status glyph names** in visually hidden text — PASS (223).

### The operator row label should resolve to a human name, not a raw `operator_user_id` · **MEDIUM**

Location: `EXPERIENCE.md` 127, 247; `DESIGN.md` 617, `operator-text.label` 288-290.

On a multi-operator node the label "names the sender's `operator_user_id`, not a bare `operator`." Read literally, a screen
reader (and every sighted reader) gets a raw id — `operator a3f9-…` — which distinguishes senders but names none of them.
AGENTS.md's `users` table is one row per human _with an identity_, so a display name is available.
**Fix:** specify that the label resolves to the `users` display name, falling back to a short id only when no name exists.
Without this the finding is a complaint; with it, it's a one-line contract.

### `text-transform`, not literal capitals · **LOW**

`QUEUED · 2` / `WILL SEND · 2` and the `operator` / `assistant` role labels are uppercase section-label typography
(`DESIGN.md` 506; `EXPERIENCE.md` 133). Some AT spells literal DOM capitals letter-by-letter. The draft box already dodges
this by giving a sentence-case _accessible name_ (245); confirm the role labels and occurrence headers rely on CSS
`text-transform: uppercase` over lowercase DOM text, not literal caps. Build-verification, not a design change.

### SC 2.5.3 Label in Name — clean pass, with a caveat · PASS

Accessible names are engineered (243) and the visible label is a substring of each — `Queue` ⊂ `Queue message, 2 waiting`,
`Send now` ⊂ `Send now, 2 waiting`. Worth one line because a builder appending the `Cmd`/`Ctrl`+`Enter` hint (202) must keep
the visible word at the **start** of the accessible name, or 2.5.3 (and speech-input targeting) breaks.

---

## What is clean and should not be re-opened

- Outcome never rides on colour (1.4.1) — all four steering channels carry text/shape.
- `aria-disabled` over native `disabled` throughout (focus management) — the spine found the blur-to-body trap itself.
- Dock focus-not-obscured (SC 2.4.11): dock is a sibling of the scroller, growth preserves the focused row's scroll position
  (253-254, 252).
- Every changed dock surface is measured for contrast (1.4.3 / 1.4.11), including the strengthened focus ring.
- The single polite region over two competing regions (242) — the right architecture; the fix is serialization _within_ it,
  not a second region.

---

## Unresolved questions for the owner

1. **SC 2.2.1:** confirm the extend mechanism — a warning + one-action extend, or reset-the-clock-on-composer-activity? (The
   latter is lighter and fits the dock grain.) The 30-minute value stays either way.
2. **4.1.3 delivery-failure:** is `role="alert"`/assertive acceptable for the one must-not-miss message, or must everything
   stay polite and coalesced?
3. **Operator label:** confirm a `users` display name is resolvable at render time for the multi-operator case (schema says
   yes; wiring to confirm).

Status: DONE_WITH_CONCERNS

---

## Resolution (orchestrator, 2026-09-13)

All findings addressed. The 30-minute value stays exactly as owner-ratified; no design was re-elicited.

- **SC 2.2.1 (HIGH)** — RESOLVED, owner decision. Kevin chose **reset-on-activity**. The 30-min timer is now an **inactivity** timer re-armed by composer activity (keystroke/focus/Send now), with the limit disclosed up front (`no redirect ends this node after 30 min of inactivity · typing keeps it open`). Propagated for engine consistency as a debounced authorized _composing keepalive_ over the Send/Interrupt route family that **re-arms** the timer without resolving idle-await: EXPERIENCE.md row "Interrupt with no redirect", spine AD-4, engine-integration build-list #2, SPEC.md, control-states.md.
- **SC 4.1.3-A collision (HIGH)** — RESOLVED. EXPERIENCE.md "New rows are announced…" now states a **serialization mechanism, not a priority**: coincident writes coalesce into one composite announcement per transition (steering state last); delivery-failed-back-to-queue moved to its own **assertive `role="alert"`**; `agent interrupting` suppressed when `Stopping…` is not rendered.
- **4.1.3-B 30-min-fail announcement (MED)** — RESOLVED. Enumerated as a fifth dock status message with distinct copy `node failed · interrupted with no redirect · these never left this tab`; inherits the finished-node focus + read-only-box treatment (focus-carry added to row 174).
- **4.1.3-C `agent idle` copy (LOW-MED)** — RESOLVED. Sub-state announcements now carry their consequence (`agent idle · Send now delivers`).
- **Contrast dim-floor (MED)** — RESOLVED. DESIGN.md `send-control` gains `blocked-legacy`/`blocked-console` = text-secondary, mirroring `stop-control`'s `stopping-*`.
- **Cmd/Ctrl+Enter guard (MED)** — RESOLVED. Gated by the same `aria-disabled` condition as the click path.
- **Operator label display name (MED)** — RESOLVED, orchestrator decision (schema-backed). Label resolves the `operator_user_id` to the `users` display name, short-id fallback; never a raw id.
- **Reduced motion + text-transform/SC 2.5.3 (LOW×2)** — RESOLVED. Dock reduced-motion stated; two build-verification points added.

Residual note (not a finding): reset-on-activity leaves a fully passive present operator (reading 30 min with zero interaction) still subject to the limit — the belt-and-suspenders pre-expiry warning is the declined "both" option, addable later.
