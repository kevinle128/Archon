# Handoff: Node room — readable transcript + steering dock

## Overview

The node room panel on both Archon web surfaces: the **readable agent transcript** (the read half,
CAP-1..7) and the **composer dock** it is written from (the write half, CAP-8..13), plus a **pinned
todo strip** and a **loop iteration selector** that this design session added and the owner has since
confirmed **in scope** (folded into CAP-3 and CAP-6). All thirteen capabilities now live in one
unified spec, `SPEC-agent-node-room`, which merged the earlier `SPEC-readable-agent-transcript` and
`SPEC-live-agent-steering` (their write ids CAP-1..6 shifted to CAP-8..13).

Today an operator opening an agent node sees every tool call as two always-open blocks of
pretty-printed JSON, and has no way to act on a running agent. These designs replace the JSON with
one scan-line per call, and add a dock that can interrupt the agent's current turn and redirect it
without stopping the node.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing intended
look and behaviour. They are not production code to copy.

The target is this repo's own React surfaces. Recreate the designs there using the established
patterns: `packages/web/src/components/workflows/` for Legacy, `packages/web/src/experiments/console/`
for Console, shared render-neutral logic in `packages/web/src/lib/`.

Each `.dc.html` opens directly in a browser. `support.js` must sit beside them.

## Fidelity

**High-fidelity.** Every colour, font, size, and spacing value is a token that already exists on the
surface — ported verbatim from `packages/web/src/index.css` (Legacy, hue 260) and
`packages/web/src/experiments/console/theme.css` (Console, hue 265). Recreate pixel-perfectly using
those variables, not the literal values in the mockups' `:root` blocks.

## Read these first — they are canonical, this README is not

This feature was specified before it was designed. The contracts win over anything here:

| File | Owns |
| --- | --- |
| `_bmad-output/specs/spec-agent-node-room/SPEC.md` | all 13 capabilities (read CAP-1..7 + write CAP-8..13), constraints, non-goals |
| `…/tool-presentation-contract.md` | the nine tool families and each one's body arm |
| `…/todo-fold-contract.md` | how both providers' todo shapes normalize to `TodoPhase[]` |
| `…/control-states.md` | the control state machine and what each control reads |
| `…/engine-integration.md` | everything between the browser and the provider seam |
| `…/provider-steering-matrix.md` | how each provider takes a message and can be interrupted |
| `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` | every colour, size, spacing, radius — `status: final` |
| `…/EXPERIENCE.md` | component patterns, state patterns, keyboard, accessibility floor |

> The earlier `spec-readable-agent-transcript` and `spec-live-agent-steering` are **superseded** — merged into `spec-agent-node-room`. Their `SPEC.md` carries a banner pointing here; do not build from them. All six companions above now live under `spec-agent-node-room/`.

`DESIGN.md` states: *"Where this file disagrees with any mock, wireframe, or import, this file wins."*
That includes these mockups, **except** for the deltas listed next, which are deliberate and need the
contract updated.

## Deltas this design introduces — decide on each before building

Six places where these mockups deviate from the contracts. Each is a product decision, not drift.

> **Update (2026-09-13):** deltas **1** (pinned todo strip) and **6** (loop iteration selector) are **owner-confirmed in scope** and folded into CAP-3 and CAP-6 success in `spec-agent-node-room`. Their design detail below still stands as the build reference.
>
> **Reconciled (2026-09-15, sprint change proposal):** deltas **2–5** are resolved. **Delta 2** (per-item `Send now`) → **post-v1 G2** (soft-inject-gated; the v1 floor has no per-item send, per `control-states.md`). **Delta 3** (queue full-bleed band) → **adopted** into `DESIGN.md` (Components → Draft box + Elevation). **Delta 4** (detached-run dock state 8) → **adopted** into `EXPERIENCE.md` State Patterns. **Delta 5** (bordered Legacy send) → **already resolved** (`DESIGN.md` — bordered on both shells); the stale filled-button mockup note is superseded.

### 1. The todo checklist is pinned, not anchored

**Contract today:** CAP-3 — *"The checklist renders once, anchored at the last todo call; earlier todo
calls collapse to a one-line row."*

**Design:** the checklist is lifted out of the transcript flow entirely into a **pinned strip between
the transcript and the dock**, and *every* todo call in the transcript collapses to a one-line
`todo updated` row.

**Why:** anchored inline, the checklist scrolls away as new tool calls arrive — so the one thing an
operator watches is the first thing to leave the viewport. Pinning also reads closer to CAP-3's own
intent ("see the agent's current todo list **as state**, not as mutations").

**Needs updating:** `todo-fold-contract.md`, and CAP-3's success criterion.

> **Resolved (2026-09-18):** the pinned strip was adopted, but at the canonical **top** of the
> transcript panel — first child of the room region, immediately above the transcript scroller —
> not between transcript and dock as prototyped here. `todo-fold-contract.md` now states the
> pinned-strip model; the placement text above and the panel-order table under
> `Console Node Room.dc.html` below are prototype history. The strip anatomy (§Pinned todo strip)
> remains the build reference; the mock's body-bar/Raw footer and the demo-only `todoEnd` lifecycle
> rewrite are not adopted — the strip renders the folded `TodoPhase[]` unchanged and node lifecycle
> events never rewrite todo statuses.

### 2. Per-item `Send now` inside the queue, gated on soft-inject

**Contract today:** `control-states.md` — *"No per-item send while generating. While the agent
generates there is nothing an individual message can do except wait, so the only per-item actions are
keep and delete."*

**Design:** each queued item carries its own `Send now`, but **only** where the provider's open stream
takes a message mid-turn (CAP-5 soft-inject, claude streaming input). On a queue-only transport the
control is **absent, not disabled** — there it genuinely could do nothing but wait. The dock-level
control row stays `Stop` | `Queue` / `Send now`.

**Why:** `control-states.md` already carves out this exception — *"When mid-turn delivery is used
(CAP-5 …) a second path appears while generating: send without interrupting. It is honest there
because the mechanism genuinely does not interrupt anything. The states above do not move; one gains
an extra option."* Per-item is where that option belongs: the operator points at the message they
want delivered.

**Still spike-gated.** The v1 floor is interrupt + `Queue`. Whether claude's `AsyncIterable`
streaming input composes with the resume protocol is unverified at the pinned SDK (0.3.209). Build
the control behind the provider capability flag; it stays unrendered until the spike clears.

**Needs updating:** `control-states.md` → *Behaviour inside a state*.

### 3. The queue is a full-bleed band, peer of the todo strip

**Contract today:** `DESIGN.md` — *"**Draft box** — a `surface-inset` panel above the composer
field"*, and *"the composer field and draft box sink to `surface-inset` (they are wells written
into)"*.

**Design:** the draft box leaves the dock's padded column and becomes a **full-width
`surface-elevated` band** with a 1px top rule, sitting directly above the composer dock and directly
below the todo strip, sharing that strip's exact header idiom and item geometry.

**Why:** a well is the idiom for something you type into. You do not type into the queue — it is a
readout of already-committed messages with per-item actions, structurally the same object as the todo
strip. Indented inside the dock it aligned with the composer field and read as part of it. The
composer field remains the only well in the dock, which is correct.

**Needs updating:** `DESIGN.md` → Components → Draft box, and Elevation & Depth.

### 4. `detached run` is a dock state that was never drawn

**Contract today:** `spec-agent-node-room` requires it (`engine-integration.md` §3) — *"no live handle
in this process (detached) → a clear 'not steerable here'"* — but no earlier mockup rendered it.

**Design:** state 8. Node pill stays `running`; no field, no controls; one disclosure line:
`not steerable here · this run was started detached, so its live session is not in this process`.

**Needs updating:** add the row to `EXPERIENCE.md` → State Patterns.

### 5. The Legacy send control is bordered, not filled

`mockups/key-steering-dock.html` says Legacy's send control is the filled shadcn `Button` the ask card
uses. **That note is stale.** `DESIGN.md` reversed it on measurement: `--primary-foreground` on
`--primary` is **3.06:1**, and an 11.5px label needs 4.5:1. Bordered measures 14.08:1 / 16.72:1.
Primacy is carried by the right-edge position. Both shells are bordered. Recorded here because the
stale mockup is still in the repo.

Related production finding this run surfaced and does not own: the Legacy ask card's shipped Submit
button reads **3.06:1** today (`AskCard.tsx:377`).

### 6. Loop iterations: selector wired, and what the dock does on an old one

**Contract today:** the Execution select already ships (`ConsoleRoomHeader.tsx:60`; Legacy
`.exec-select`), and loop rows are already labelled `name ×N` (`build-log-rows.ts:224`). What the
contracts never state is **what the dock does when the operator reads a finished iteration back**.

**Design:** the select defaults to the running iteration. Picking a finished one:

- panel pill → `Completed`, header meta → that iteration's own timings
- the pinned todo strip → **that iteration's** final checklist
- the dock collapses to one line — `reading a finished iteration · the agent is working in
  iteration N` — plus a `Go to iteration N` control
- the queue band **stays rendered but read-only**: no `Send now`, no delete, no next-out mark

**Why:** steering targets only the live iteration, so on a finished one the composer is absent and
**no steering request is issued** — there is nothing to reject on arrival, and the node-scoped Send
route carries no iteration identity to reject on. The band stays because the operator's own queued
words are never discarded silently — they still deliver once the operator is back on the live
iteration; only the controls would be lying.

The log stream and the select are **two entry points to one selection** and stay in sync both ways.

**Needs updating:** new rows in `EXPERIENCE.md` → State Patterns.

## Screens

Four files. `Console Node Room` and `Legacy Node Room` are the two shipping surfaces; the other two
are state catalogues for review.

### `Console Node Room.dc.html` — 1280×820

The `/console` run room with the node panel open. Chrome traced from
`experiments/console/components/ConsoleNodeRoom.tsx` and the HITL mockup contract; panel width
**520px** (the Console mock's own choice).

Panel column, top to bottom:

| Part | Height | Notes |
| --- | --- | --- |
| panel header | 66px | type pill, node name, status pill, `✕`; meta line; Execution select when loop |
| transcript | `flex: 1` | the scroller — the only scrolling region |
| todo strip | 28px collapsed | `surface-elevated`, 1px top rule, full bleed |
| queue band | 28px collapsed | same treatment; rendered only when it holds something |
| composer dock | auto | disclosure line, composer field, control row |

The strips are **flex siblings of the scroller, never children of it** — they cannot cover the last
transcript row, which on a running node is the row being watched (SC 2.4.11).

> Prototype ordering — superseded: canonical placement puts the **todo strip at the top of the
> panel**, first child of the room region immediately above the transcript scroller, so `transcript`
> and `todo strip` swap in the table above. The queue band and composer dock keep their bottom
> slots.

**Controls above the frame are review scaffolding, not product UI:** the 8 agent sub-states, the
`prompt` / `loop ×3` node-kind switch, and the `claude · soft-inject` / `codex · queue only`
transport switch. Do not build them.

### `Legacy Node Room.dc.html` — 1280×820

The `WorkflowExecution` room, panel width **460px**. Row anatomy is byte-identical to Console; only
the `:root` token block differs. That is the visual proof of the one-presenter-two-renderers
constraint.

**460px is the width to verify against** — it is the narrower of the two and the only one the room
contract states (`spec-workflow-run-view-hitl/ux-mockup/styles.css:1111`).

### `Transcript States.dc.html`

Surface-independent catalogue: A chip legend (5 treatments / 9 families), B the five status glyphs,
C collapsed rows + four hard cases (long path, Codex whole-script tool name, MCP `server · tool`,
unknown tool), D every expanded body arm (shell, file diff, web, search, glob, code, todo × both
providers, task × both providers), E three occurrence-header wordings to pick from, F the Raw toggle
open.

### `Steering Dock States.dc.html`

Eight dock states at a 300px panel crop, the operator row in the record, the three message-status
treatments (`sent` / `delivered` / `Never sent`), and a table of what the dock refuses to do and why.

## Components

Every value below is in `DESIGN.md`'s frontmatter, which is the authority. Repeated here only for the
parts this session added or changed.

### Tool row — one scan-line

```
▸    ✓    [chip]   headline ……………………………   badges
9px  12px  auto     flex 1 · min-width 0       auto
```

`<details>` with the native marker hidden; padding `4px 6px`; radius 6px; mono 12px. Chevron and
glyph are fixed columns so every chip starts at the same x. Headline **must** carry `min-width: 0`.
A path headline is head (`flex: 0 1 auto`, text-secondary) + tail (`flex: 0 0 auto`, text-primary) —
the head must not grow. Hover → `surface-hover`; `:focus-visible` → 2px `--accent-bright`
(Console `outline-offset: 2px`, Legacy `-2px`); open rotates the chevron 90° over 120ms.

Status glyphs are **five different characters**, colour only reinforces: `✓` success, `✕` error,
`◐` running, `⚠` interrupted, `–` unknown. Never a coloured dot.

Family chips: 11px, padding `1px 7px`, radius 4px, on `surface-elevated`, 1px border in the family
hue at 40% (search and glob 45%), `max-width: 24ch`. Chip text is the tool name as the provider sent
it, and only when that name is a single token ≤ 24 chars — otherwise the **family name**.

### Pinned todo strip — new

Container: `flex-shrink: 0`, `border-top: 1px solid var(--border)`, `background: var(--surface-elevated)`,
full bleed, no radius.

Header button — `display:flex; align-items:center; gap:8px; width:100%; padding:6px 10px`,
hover `--surface-hover`, focus 2px `--accent-bright` at `outline-offset:-2px`:

```
TODO   ◐ Run full auto_retry suite   ▬▬▬▬▭▭ 4/6   ▾
```

- `TODO` — 10px, weight 700, `letter-spacing:.07em`, uppercase, text-secondary
- the **current item**, not the phase names — mono 11.5px, text-primary, with its status glyph.
  Resolution order: the `current` item, else a `blocked` one, else the last `done` one
- meter — one 3px cell per non-phase item, `flex: 1 1 auto`, `gap: 2px`; `--success` done,
  running colour current, `--warning` blocked, `--border-bright` pending. The count beside it
  carries the same fact in text, so nothing is encoded in hue alone
- count — mono 10px text-secondary
- caret — `▾` 9px text-tertiary, `rotate(180deg)` when open, 120ms

Body (open): `padding:4px 10px 8px; max-height:168px; overflow-y:auto; border-top:1px solid var(--border)`.
Phase labels 10px tracked uppercase with `margin:8px 0 2px`. Items: `display:flex; gap:8px;
align-items:baseline; line-height:1.75; padding:1px 4px 1px 2px; radius:4px`, 12px centred glyph
column, mono 11.5px. The **current** item gets `background: var(--surface)` plus
`box-shadow: inset 2px 0 0 <running>` and text-primary — a shape, not just a colour. Item glyphs:
`☑` done, `◐` current, `⊘` blocked, `☐` pending, `☐` + line-through + `· dropped` abandoned.
~~Body bar + 24px Raw button at the foot.~~

> Not adopted: the body-bar/Raw footer — a fold across many calls has no single truthful raw
> payload, and Raw belongs to an individual tool row (CAP-7).

**Default collapsed.** Expanded by default the strip plus the dock took 63% of the panel and left the
transcript ~183px, which breaks CAP-1 (scanning a forty-call node) and `DESIGN.md`'s own rule that
the dock never grows to swallow the transcript.

**Cap in px, not `vh`.** `30vh` is the browser viewport, not this panel — on a tall window it grows
to ~300px and stacks with the draft box's own cap.

**It follows the node's lifecycle, not just the iteration.** On a completed node the plan reads
`☑ … 6/6`; on the 30-minute-failed node the interrupted item returns to `☐` and the count stays
`4/6` — it must not claim work finished. A completed pill above a running `◐` is the defect to avoid.

> Not adopted — demo-only `todoEnd` rewrite. The mocks' `todoEnd` knob fabricates statuses on
> terminal nodes (every item `done` on a completed node; the interrupted item demoted to `☐` on a
> failed one). The shipped strip renders the folded `TodoPhase[]` unchanged: only recorded todo
> calls change statuses, so a failed node keeps showing the item that was `◐` when it stopped.

### Queue band — restructured

Same container, header idiom, body padding, item geometry and caret as the todo strip.

```
QUEUED · 2                                          ▾
 1  wrong suite — use -p archon-workflows   [Send now]  ✕
 2  and skip the doctests                   [Send now]  ✕
```

- header word is the whole signal of what the control below means: `Queued` while generating,
  `Will send` while idle-after-interrupt, `Never sent` once the node has finished and the box is
  read-only
- `this tab only` labels the **unsent draft** only; the `QUEUED` band header is just `QUEUED · N` (no scope label — per `DESIGN.md` queue-band spec) — a queued message is server-side (node-scoped registry queue), not per-tab browser state
- ordinal in the 12px lead column, mono 10px — the queue delivers in **written order**, and this
  makes that visible
- item text in **sans** 11.5px, not mono: it is what a human wrote. Mono is the machine's voice
- the item that will be delivered next carries the same `inset 2px 0 0` mark the running todo item
  does — one grammar for "this is next". Absent in read-only states
- `Send now` is a bordered chip (the Raw toggle's idiom), `✕` is 24×24 — both at the 24px SC 2.5.8
  floor grown on padding, **not** the dock's 32px, which an 11px row cannot carry
- **every per-item control is named with its message**: `aria-label="Send now: <text>"`,
  `aria-label="Delete: <text>"`. Two identical `Send now` names is a control a voice or screen-reader
  operator cannot target, on the one action that cannot be undone
- **default expanded**, unlike the todo strip: the box renders only when it holds something, so
  collapsing it by default would destroy the signal it exists to carry

### Composer dock

`surface-elevated`, 1px top rule, padding `8px 10px`, children 6px apart. Top to bottom: stop
disclosure (only while idle-after-interrupt), composer field, one control row.

The control row pushes **`Stop` to the left edge and the send control to the right**. That gap is the
layout carrying a safety property: the control that stops an agent and the control that sends to it
are never a thumb's width apart.

Composer field: `surface-inset`, 1px border, radius 6px, `min-height: 56px`, padding `7px 9px`, set
in the **same sans face and size as the prose it will become** (12.5px / 1.5).

Send control: bordered both shells — transparent fill, `--border-bright`, text-primary, `min-height: 32px`,
radius 6px, weight 500, 11.5px. Label **is** the state: `Queue` while generating, `Send now` while
idle-after-interrupt. Same box, same position, **width held to the wider of the two labels**
(`min-width: 84px`) — a control that moves or resizes as well as renames is two controls.

Stop control: same box at the left edge. Reads `Stop`, then `Stopping…` while the interrupt is in
flight. **`Stopping…` is `aria-disabled`, never the `disabled` attribute** — the native attribute
blurs the element that carries it, returning a keyboard operator to `<body>` and then the top of the
document, with the whole transcript between them and the dock. Its dim floor is **text-secondary**
(5.33:1 / 7.90:1), not the shadcn tertiary convention (2.31:1 / 3.88:1, a failure). Never filled and
never in the error colour: an interrupt leaves the agent able to continue.

Stop disclosure: `stopped after the last completed tool call · files already written stay written`.
One line of mono 10.5px text-secondary, rendered only while idle-after-interrupt. It is a slot in the
dock's anatomy, not a caption on another component — it is the one place the interface corrects a
belief the operator is likely to hold, and a caption gets dropped by whoever rearranges the thing it
hangs off.

### Operator row in the transcript

Same anatomy as assistant prose, one step up: sans 12.5px / 1.55 in **text-primary**, under a 10px
uppercase text-secondary label that names the **sender** (`operator_user_id`), with the message-status
badge right-aligned on the label line.

Two channels separate the operator's words from the model's and **neither is a hue**: the label says
who wrote it, and full-strength text against the model's secondary says it again. A reader who can
distinguish no colour at all still cannot confuse them.

Message status is the **words** `sent` and `delivered`, never a dot and never colour alone. `sent` is
text-secondary; `delivered` takes the success colour *in addition to* the word. At the pinned SDK no
provider echoes, so `delivered` is unreachable today — do not render it.

## Interactions & behaviour

- **Rows** — native `<details>`. Successful calls collapsed on first render, **failed calls expanded**.
- **Both strips** — `<button aria-expanded>` headers, caret rotates 180° over 120ms.
- **Execution select** — `onChange` selects the row; the log stream's `implement ×N` rows select the
  same thing. Defaults to the running iteration.
- **`Stop`** → the dock's UI-local `interrupting` transient (sub-second, in-process; not a status
  poll; **not** a core-projected value — AD-9) → `idle-after-interrupt`. The **node stays `running`
  throughout** and the rest of the run is
  unaffected: independent siblings and later layers keep going. The interface must not imply the run
  stopped.
- **`Send now`** (dock level) → delivers every queued message plus the one just typed, **in written
  order**, as the next turn on the same live session. Every queued item leaves the box before delivery
  starts, so nothing can be picked up twice; on failure items return to the **front** of the queue.
- **`Queue`** → holds the message; delivered at the natural turn boundary. Nothing is interrupted.
- **A new message joins the end of the queue**, never jumps it — the agent reads corrections in the
  order the operator thought of them.
- **No Enter to send.** A stray keystroke must not be able to reach a running agent.
- **Controls follow the agent's projected sub-state**, never a remembered mode and never a raw "is a
  chunk arriving right now" signal that flickers under the operator's cursor. There is no toggle
  anywhere, so there is nothing to leave in the wrong position.
- **No optimistic flip to idle** before the interrupt is acknowledged.
- **The 30-minute idle-await timer is an inactivity timer** (SC 2.2.1): a debounced authorized
  composing keepalive re-arms it without resolving idle-await.
- **Focus ring** — 2px `--accent-bright` on every focusable element in this panel: transcript row,
  send control, stop control, composer field, draft item, both strip headers. This is a **deliberate
  departure**: Console's shipped `:focus-visible` uses `--accent-ring` (magenta at 30% alpha), which
  composites to **1.4:1** — under SC 1.4.11's 3:1 floor. On Legacy a dock control must override
  shadcn's `focus-visible:ring-ring/50` (`button.tsx:8`, 2.25:1) rather than inherit it.

## State

Agent sub-state inside `node = running` — the core projects **exactly two** typed values,
`generating` | `idle-after-interrupt` (AD-9); `interrupting` is a **UI-local optimistic transient**,
not a projected value. Plus node lifecycle (`running` | `completed` | `failed`),
the per-tab **unsent draft** (queued messages are server-side, not client state), the selected execution, and two local disclosure booleans for the strips.

The eight states the mockups render: `generating`, `interrupting`, `idle-after-interrupt`,
`generating again`, `finished · undelivered`, `finished · clean`, `failed · 30-min`, `detached run`.

Reconciliation runs **only on the node's terminal event** (`node_completed` / `node_failed`, after
the executor's last write) — never a live refetch, which could mis-mark a delivered message and
duplicate it on resend. Any `sent` id with no matching `message_id` on a written operator row is
**restored to the draft box as `Never sent`**, read-only.

Delivery is confirmed **by id alone**, never by matching text or timestamps: messages can be merged
into one turn, arrive out of order, or be echoed late, and text matching silently mis-attributes all
three.

## Design tokens

Do not hard-code these — read the variables. Values are the gamut-clamped sRGB approximations of the
oklch the CSS declares; the variable name is the authority.

| Role | Legacy `index.css` | Console `theme.css` |
| --- | --- | --- |
| `--surface` | `#101215` | `#0F1014` |
| `--surface-elevated` | `#181B1F` | `#15171B` |
| `--surface-inset` | `#050607` | `#06070A` |
| `--surface-hover` | `#1C1F24` | `#191C21` |
| `--border` | `#26292E` | `#25282E` |
| `--border-bright` | `#363B43` | `#383C44` |
| `--text-primary` | `#E6E8EB` | `#F5F7FA` |
| `--text-secondary` | `#8C8F95` | `#A8ACB6` |
| `--text-tertiary` | `#52555B` | `#70757F` |
| `--success` | `#00AC5F` | `#00D09B` |
| `--error` | `#DE3B3D` | `#FF4D64` |
| `--warning` | `#E49E22` | `#E7B643` |
| running | `#35A9FF` (`--accent-bright`; Legacy declares no `--running`) | `#3DACFE` (`--running`) |
| focus ring | `#35A9FF` (`--accent-bright`) | `#E400DE` (`--accent-bright`, opaque) |

Family hues — all four inherited, no token introduced: `--node-bash` `#E49E22` (shell, code),
`--node-command` `#0089ED` (file, web), `--node-prompt` `#7D5EE0` (search, glob),
`--node-approval` `#FB794A` (todo, task). Generic takes no hue.

Type — mono for everything except prose: Legacy `--font-mono` JetBrains Mono / Console `.font-mono`
Geist Mono. Sans for the three things a human or the model wrote: the operator's row, the composer
field, assistant prose. Legacy `--font-sans` Inter / Console Geist with `ss01`, `cv11`.

Scale: 12px row · 11px chip and badge · 11.5px body and checklist · 10.5px body bar and occurrence
header · 10px phase label · 12.5px prose · 11.5px weight-500 dock controls. Only the status glyph is
bold inside the transcript.

Spacing: row `4px 6px`, row gap 8px, chevron 9px, glyph 12px, **body indent 29px** (chevron + gap +
glyph, so the rail sits under the chip), rail 2px, body padding-left 10px, box `8px 10px`, chip
`1px 7px`, dock `8px 10px`, dock gap 6px, composer min-height 56px, control min-height 32px,
per-item control min 24px.

Radius: **6px** rows, body boxes, sub-cards, dock boxes, both controls. **4px** family chip, Raw
button, per-item controls. `9999px` is reserved for the room's run and node status badges and is
**banned** inside the panel — a family chip must never be mistakable for a status badge.

**No shadows.** Depth is tonal only.

Contrast floor is 4.5:1 for all transcript text (it is 10–12px). Two accepted shortfalls, both
recorded in `DESIGN.md`: `--node-prompt` on both backgrounds (3.7:1 / 3.9:1 — the one open question),
and Legacy's `--error` badge at 4.3:1.

## Assets

None. No images, no icon font, no SVG. Status glyphs and checklist marks are text characters, which
is the point — they survive without colour.

## Where this lands in the codebase

| Concern | File |
| --- | --- |
| shared render-neutral item model | `packages/web/src/lib/agent-history.ts` (`buildAgentHistory`, `AgentHistoryItem`, `deriveOutcome` at `:120`) |
| Legacy renderer | `packages/web/src/components/workflows/NodeRoom.tsx`, `NodeTranscriptPane.tsx` |
| Console renderer | `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`, `ConsoleExecutionHistory.tsx` |
| Console room shell | `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` |
| Execution select | `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx:60` |
| loop rows and `×N` labels | `…/inspect/build-log-rows.ts:224`, `select-room-data.ts`, `select-node-node-messages.ts` |
| tokens | `packages/web/src/index.css`, `packages/web/src/experiments/console/theme.css` |

Hard constraints from the specs:

- `@archon/web` must **not** import from `@archon/workflows`; wire types come from
  `api.generated.d.ts` through `lib/api.ts`.
- Console must **not** import from `@/components/`. Shared logic goes in `packages/web/src/lib/`
  and the JSX is written twice, thin. That fork is deliberate and already costed.
- **No raw `JSON.stringify` as a default presentation anywhere.** It survives only behind CAP-7's
  explicit Raw toggle. This is the defect being fixed; re-introducing it in a fallback path fails
  the spec.
- Provider shape differences normalize **at the edge**, never branched on in a renderer. Tool
  identification duck-types over alias sets — **no name-keyed mapping table**.
- The transcript half ships **no schema change, no migration, no backend change** — that is what
  keeps it retroactive over every run already in the database.
- The steering half is **not** retroactive: it needs the engine seam, three additive `metadata`
  fields (`origin`, `operator_user_id`, `message_id`) on a `.strict()` schema, a regenerated
  `api.generated`, and two new routes.
- **Build order:** steering CAP-11 writes an operator row, and `AgentHistoryItem` has kinds
  `assistant | tool | lifecycle` — an operator row is none of them. Because both halves are now one
  spec (`spec-agent-node-room`), this is an **internal** ordering dependency: the read-half transcript
  reader must recognize `origin='operator'` **first**, or an operator `text` row renders as agent text.
- Strict TypeScript, no unjustified `any`, ESLint at zero warnings. `bun run validate` is the
  pre-PR gate. Comments and test names carry **no** plan or section references.

## Files in this bundle

| File | What |
| --- | --- |
| `Console Node Room.dc.html` | Console surface, 520px panel, all 8 dock states, loop mode |
| `Legacy Node Room.dc.html` | Legacy surface, 460px panel, same states |
| `Transcript States.dc.html` | families, glyphs, hard cases, every expanded body arm |
| `Steering Dock States.dc.html` | 8 dock states, operator row, message status, refusals |
| `support.js` | runtime the four files need; must sit beside them |

The originals these were ported from are still in the repo at
`_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/mockups/` — five static HTML files,
superseded by this bundle except where noted in delta 5.
