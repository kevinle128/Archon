---
name: Archon
description: The node room on both web surfaces — the readable agent transcript that is read, and the steering dock it is written from. shadcn/Radix on Tailwind v4, dark-only; this DESIGN.md specifies both deltas over two inherited token sets and forks neither palette.
status: final
updated: 2026-09-20
sources:
  - ../../../specs/spec-agent-node-room/sources/spec-readable-agent-transcript/SPEC.md
  - ../../../specs/spec-agent-node-room/sources/spec-readable-agent-transcript/tool-presentation-contract.md
  - ../../../specs/spec-agent-node-room/sources/spec-readable-agent-transcript/todo-fold-contract.md
  - ../../../specs/spec-agent-node-room/sources/spec-live-agent-steering/SPEC.md
  - ../../../specs/spec-agent-node-room/sources/spec-live-agent-steering/control-states.md
  - ../../../specs/spec-agent-node-room/sources/spec-live-agent-steering/engine-integration.md
  - ../../../specs/spec-workflow-run-view-hitl/ux-mockup/README.md
  - ../../../project-context.md
  - ../../../../packages/web/src/index.css
  - ../../../../packages/web/src/experiments/console/theme.css
colors:
  # Every value below is an EXISTING CSS variable. The CSS declares oklch; the hex here is the
  # gamut-clamped sRGB approximation for tooling. The variable name in the comment is the authority.
  #
  # Family chip hues — all four, shared by both surfaces. No token is introduced.
  node-bash: '#E49E22' # --node-bash      oklch(0.75 0.15 75)   index.css:30, Console inherits
  node-command: '#0089ED' # --node-command   oklch(0.62 0.18 250)  index.css:28, Console inherits
  node-prompt: '#7D5EE0' # --node-prompt    oklch(0.58 0.19 290)  index.css:29, Console inherits
  node-approval: '#FB794A' # --node-approval  oklch(0.72 0.17 40)   index.css:32, Console inherits
  #
  # Legacy surface — packages/web/src/index.css :root, hue 260
  surface-legacy: '#101215' # --surface
  surface-elevated-legacy: '#181B1F' # --surface-elevated
  surface-inset-legacy: '#050607' # --surface-inset
  surface-hover-legacy: '#1C1F24' # --surface-hover
  border-legacy: '#26292E' # --border
  border-bright-legacy: '#363B43' # --border-bright
  text-primary-legacy: '#E6E8EB' # --text-primary
  text-secondary-legacy: '#8C8F95' # --text-secondary
  text-tertiary-legacy: '#52555B' # --text-tertiary
  success-legacy: '#00AC5F' # --success
  error-legacy: '#DE3B3D' # --error
  warning-legacy: '#E49E22' # --warning
  running-legacy: '#35A9FF' # --accent-bright — index.css declares no --running; the mock uses accent-bright for ◐
  focus-legacy: '#35A9FF' # --accent-bright, 2px outline, offset -2px
  #
  # Console surface — console/theme.css .console-root, hue 265
  surface-console: '#0F1014' # --surface
  surface-elevated-console: '#15171B' # --surface-elevated
  surface-inset-console: '#06070A' # --surface-inset
  surface-hover-console: '#191C21' # --surface-hover
  border-console: '#25282E' # --border
  border-bright-console: '#383C44' # --border-bright
  text-primary-console: '#F5F7FA' # --text-primary
  text-secondary-console: '#A8ACB6' # --text-secondary
  text-tertiary-console: '#70757F' # --text-tertiary
  success-console: '#00D09B' # --success = --brand-teal
  error-console: '#FF4D64' # --error
  warning-console: '#E7B643' # --warning
  running-console: '#3DACFE' # --running
  focus-console:
    '#E400DE' # --accent-bright = brand magenta, opaque, 2px outline, offset 2px.
    # DELTA, not inheritance: console ships --accent-ring (30% alpha) at 1.4:1. See Colors.
typography:
  mono:
    note: 'Legacy --font-mono (JetBrains Mono, ui-monospace) · Console .console-root .font-mono (Geist Mono, ui-monospace). Inherited, never restated. Everything in the transcript except assistant prose.'
  sans:
    note: 'Legacy --font-sans (Inter) · Console .console-root (Geist with ss01/cv11). Assistant prose only.'
  row:
    fontSize: 12px
    fontWeight: '400'
  glyph:
    fontSize: 12px
    fontWeight: '700'
  chip:
    fontSize: 11px
    fontWeight: '400'
  badge:
    fontSize: 11px
    fontWeight: '400'
  body-bar:
    fontSize: 10.5px
    fontWeight: '400'
  body-text:
    fontSize: 11.5px
    lineHeight: '1.5'
  checklist:
    fontSize: 11.5px
    lineHeight: '1.85'
  phase-label:
    fontSize: 10px
    letterSpacing: 0.07em
  occurrence-header:
    fontSize: 10.5px
    letterSpacing: 0.08em
  assistant:
    fontSize: 12.5px
    lineHeight: '1.55'
  subtask-agent:
    fontSize: 11.5px
    fontWeight: '600'
  control:
    fontSize: 11.5px
    fontWeight: '500' # dock buttons only; nothing in the transcript carries weight 500
rounded:
  sm: 4px # family chip, Raw button. Same radius as the room's node type-pill.
  md: 6px # row hover, body box, sub-card. Equals the inherited --radius-sm (calc(0.625rem - 4px)).
  lg: 0.625rem # --radius. Room chrome only; the transcript never uses it.
  full: 9999px # Reserved for the room's run and node status badges. Never on a transcript chip.
spacing:
  row-y: 4px
  row-x: 6px
  row-gap: 8px
  chevron-w: 9px
  glyph-w: 12px
  body-indent: 29px # chevron-w + row-gap + glyph-w — the body rail sits under the chip
  body-rail: 2px
  body-pad-left: 10px
  body-margin-bottom: 8px
  box-pad: 8px 10px
  chip-pad: 1px 7px
  chip-max: 24ch
  subcard-pad: 6px 9px
  occurrence-margin: 10px 0 5px
  kv-key-w: 11ch
  dock-pad: 8px 10px
  dock-gap: 6px
  draft-item-pad: 4px 8px
  composer-min-h: 56px
  control-min-h: 32px # clears SC 2.5.8 by 8px; the tool row clears it at 24px (grown via padding)
components:
  tool-row:
    font: '{typography.mono}'
    fontSize: '{typography.row.fontSize}'
    padding: '{spacing.row-y} {spacing.row-x}'
    gap: '{spacing.row-gap}'
    radius: '{rounded.md}'
    hover-legacy: '{colors.surface-hover-legacy}'
    hover-console: '{colors.surface-hover-console}'
    focus-legacy: '{colors.focus-legacy}'
    focus-console: '{colors.focus-console}'
  chevron:
    width: '{spacing.chevron-w}'
    # The only element left in text-tertiary. It is decoration, hidden from assistive
    # technology, and carries no fact - so the 2.5:1 it measures on Legacy costs nothing.
    legacy: '{colors.text-tertiary-legacy}'
    console: '{colors.text-tertiary-console}'
  status-glyph:
    width: '{spacing.glyph-w}'
    fontWeight: '{typography.glyph.fontWeight}'
    succeeded-legacy: '{colors.success-legacy}'
    succeeded-console: '{colors.success-console}'
    failed-legacy: '{colors.error-legacy}'
    failed-console: '{colors.error-console}'
    running-legacy: '{colors.running-legacy}'
    running-console: '{colors.running-console}'
    interrupted-legacy: '{colors.warning-legacy}'
    interrupted-console: '{colors.warning-console}'
    unknown-legacy: '{colors.text-secondary-legacy}'
    unknown-console: '{colors.text-secondary-console}'
  family-chip:
    fontSize: '{typography.chip.fontSize}'
    padding: '{spacing.chip-pad}'
    radius: '{rounded.sm}'
    maxWidth: '{spacing.chip-max}'
    background-legacy: '{colors.surface-elevated-legacy}'
    background-console: '{colors.surface-elevated-console}'
    border: '1px solid, family hue at 40% (search and glob at 45%)'
    shell: '{colors.node-bash}'
    file: '{colors.node-command}'
    web: '{colors.node-command}'
    search: '{colors.node-prompt}'
    glob: '{colors.node-prompt}'
    code: '{colors.node-bash}'
    todo: '{colors.node-approval}'
    task: '{colors.node-approval}'
    generic-legacy: '{colors.text-secondary-legacy}'
    generic-console: '{colors.text-secondary-console}'
  headline:
    text-legacy: '{colors.text-primary-legacy}'
    text-console: '{colors.text-primary-console}'
    path-head-legacy: '{colors.text-secondary-legacy}'
    path-head-console: '{colors.text-secondary-console}'
    folded-todo-legacy: '{colors.text-secondary-legacy}'
    folded-todo-console: '{colors.text-secondary-console}'
  badge:
    fontSize: '{typography.badge.fontSize}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
    exit-nonzero-legacy: '{colors.error-legacy}'
    exit-nonzero-console: '{colors.error-console}'
    added-legacy: '{colors.success-legacy}'
    added-console: '{colors.success-console}'
    removed-legacy: '{colors.error-legacy}'
    removed-console: '{colors.error-console}'
    running-legacy: '{colors.running-legacy}'
    running-console: '{colors.running-console}'
  tool-body:
    marginLeft: '{spacing.body-indent}'
    marginBottom: '{spacing.body-margin-bottom}'
    rail: '{spacing.body-rail}'
    rail-legacy: '{colors.border-legacy}'
    rail-console: '{colors.border-console}'
    paddingLeft: '{spacing.body-pad-left}'
  body-bar:
    fontSize: '{typography.body-bar.fontSize}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
  raw-toggle:
    fontSize: '{typography.body-bar.fontSize}'
    radius: '{rounded.sm}'
    padding: '{spacing.chip-pad}'
    minHeight: 24px # SC 2.5.8. Grown by padding, so the painted box is unchanged.
    background: transparent
    border-legacy: '{colors.border-legacy}'
    border-console: '{colors.border-console}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
    open-text-legacy: '{colors.text-primary-legacy}'
    open-text-console: '{colors.text-primary-console}'
    open-border-legacy: '{colors.border-bright-legacy}'
    open-border-console: '{colors.border-bright-console}'
  body-box:
    fontSize: '{typography.body-text.fontSize}'
    lineHeight: '{typography.body-text.lineHeight}'
    padding: '{spacing.box-pad}'
    radius: '{rounded.md}'
    background-legacy: '{colors.surface-inset-legacy}'
    background-console: '{colors.surface-inset-console}'
    text-legacy: '{colors.text-primary-legacy}'
    text-console: '{colors.text-primary-console}'
    annotation-legacy: '{colors.text-secondary-legacy}' # line numbers, code comments
    annotation-console: '{colors.text-secondary-console}'
    prompt-sigil: '{colors.node-bash}'
    path: '{colors.node-command}'
    keyword: '{colors.node-prompt}'
    string-legacy: '{colors.success-legacy}'
    string-console: '{colors.success-console}'
  checklist:
    fontSize: '{typography.checklist.fontSize}'
    lineHeight: '{typography.checklist.lineHeight}'
    done-legacy: '{colors.success-legacy}'
    done-console: '{colors.success-console}'
    current-legacy: '{colors.running-legacy}'
    current-console: '{colors.running-console}'
    blocked-legacy: '{colors.warning-legacy}'
    blocked-console: '{colors.warning-console}'
    pending-legacy: '{colors.text-secondary-legacy}'
    pending-console: '{colors.text-secondary-console}'
    abandoned: 'pending colour plus line-through'
    phase-label: '{typography.phase-label}'
  subtask-card:
    padding: '{spacing.subcard-pad}'
    radius: '{rounded.md}'
    background-legacy: '{colors.surface-elevated-legacy}'
    background-console: '{colors.surface-elevated-console}'
    agent: '{colors.node-approval}'
    agent-weight: '{typography.subtask-agent.fontWeight}'
  kv-list:
    fontSize: '{typography.body-text.fontSize}'
    keyWidth: '{spacing.kv-key-w}'
    key-legacy: '{colors.text-secondary-legacy}'
    key-console: '{colors.text-secondary-console}'
    value-legacy: '{colors.text-primary-legacy}'
    value-console: '{colors.text-primary-console}'
  occurrence-header:
    fontSize: '{typography.occurrence-header.fontSize}'
    letterSpacing: '{typography.occurrence-header.letterSpacing}'
    margin: '{spacing.occurrence-margin}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
    rule-legacy: '{colors.border-legacy}'
    rule-console: '{colors.border-console}'
  assistant-text:
    font: '{typography.sans}'
    fontSize: '{typography.assistant.fontSize}'
    lineHeight: '{typography.assistant.lineHeight}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
  # ── Steering dock ──────────────────────────────────────────────────────────
  # Write affordances. Every value resolves to a variable already shipped on the
  # surface; the dock introduces no colour and no hue of its own.
  operator-text:
    font: '{typography.sans}'
    fontSize: '{typography.assistant.fontSize}'
    lineHeight: '{typography.assistant.lineHeight}'
    # One step ABOVE assistant prose. The operator's own words are the only prose
    # in the transcript a human wrote, and the strength difference plus the role
    # label are what separate the two without a hue.
    text-legacy: '{colors.text-primary-legacy}'
    text-console: '{colors.text-primary-console}'
    label: '{typography.phase-label}'
    label-legacy: '{colors.text-secondary-legacy}'
    label-console: '{colors.text-secondary-console}'
  message-status:
    fontSize: '{typography.badge.fontSize}'
    sent-legacy: '{colors.text-secondary-legacy}'
    sent-console: '{colors.text-secondary-console}'
    delivered-legacy: '{colors.success-legacy}'
    delivered-console: '{colors.success-console}'
  composer-dock:
    padding: '{spacing.dock-pad}'
    gap: '{spacing.dock-gap}'
    background-legacy: '{colors.surface-elevated-legacy}'
    background-console: '{colors.surface-elevated-console}'
    borderTop-legacy: '{colors.border-legacy}'
    borderTop-console: '{colors.border-console}'
  composer-field:
    font: '{typography.sans}'
    fontSize: '{typography.assistant.fontSize}'
    lineHeight: '{typography.assistant.lineHeight}'
    minHeight: '{spacing.composer-min-h}'
    radius: '{rounded.md}'
    background-legacy: '{colors.surface-inset-legacy}'
    background-console: '{colors.surface-inset-console}'
    border-legacy: '{colors.border-legacy}'
    border-console: '{colors.border-console}'
    text-legacy: '{colors.text-primary-legacy}'
    text-console: '{colors.text-primary-console}'
    placeholder-legacy: '{colors.text-secondary-legacy}'
    placeholder-console: '{colors.text-secondary-console}'
    focus-legacy: '{colors.focus-legacy}'
    focus-console: '{colors.focus-console}'
  send-control:
    fontSize: '{typography.control.fontSize}'
    fontWeight: '{typography.control.fontWeight}'
    radius: '{rounded.md}'
    minHeight: '{spacing.control-min-h}'
    background: transparent
    border-legacy: '{colors.border-bright-legacy}'
    border-console: '{colors.border-bright-console}'
    text-legacy: '{colors.text-primary-legacy}'
    text-console: '{colors.text-primary-console}'
    focus-legacy: '{colors.focus-legacy}'
    focus-console: '{colors.focus-console}'
    # BORDERED on both shells, and this reverses an earlier draft. Inheriting Legacy's
    # filled shadcn Button (--primary-foreground on --primary, AskCard.tsx:377) would
    # have put an 11.5px label at 3.06:1 — a clean SC 1.4.3 failure. Bordered measures
    # 14.08:1 / 16.72:1. Primacy is carried by POSITION (the right edge) rather than by
    # a fill, which costs nothing when the row holds only two controls.
    # The pending-ask-blocked Send is aria-disabled (not the disabled attribute), so like
    # `Stopping…` it forfeits SC 1.4.3's inactive-component exemption and its label must still
    # clear 4.5:1. The dim floor is text-SECONDARY (5.33:1 / 7.90:1), never the shadcn/
    # aria-disabled tertiary convention (2.3:1 / 3.9:1, a failure) — mirroring stop-control.
    blocked-legacy: '{colors.text-secondary-legacy}'
    blocked-console: '{colors.text-secondary-console}'
  stop-control:
    fontSize: '{typography.control.fontSize}'
    fontWeight: '{typography.control.fontWeight}'
    radius: '{rounded.md}'
    minHeight: '{spacing.control-min-h}'
    background: transparent
    border-legacy: '{colors.border-bright-legacy}'
    border-console: '{colors.border-bright-console}'
    text-legacy: '{colors.text-primary-legacy}'
    text-console: '{colors.text-primary-console}'
    focus-legacy: '{colors.focus-legacy}'
    focus-console: '{colors.focus-console}'
    # The `Stopping…` dim floor is text-SECONDARY (5.33:1 / 7.90:1), not tertiary.
    # The control stays focusable via aria-disabled rather than the disabled
    # attribute, so SC 1.4.3's inactive-component exemption is not relied on.
    stopping-legacy: '{colors.text-secondary-legacy}'
    stopping-console: '{colors.text-secondary-console}'
    # Never filled and never in the error colour. A stop is recoverable; painting
    # it as a failure would misreport what it does.
  draft-box:
    padding: '{spacing.dock-pad}'
    radius: '{rounded.md}'
    background-legacy: '{colors.surface-elevated-legacy}' # full room: full-bleed band; compact/state-review: surface-inset well
    background-console: '{colors.surface-elevated-console}'
    label: '{typography.phase-label}'
    label-legacy: '{colors.text-secondary-legacy}'
    label-console: '{colors.text-secondary-console}'
    maxHeight: 33vh
    # On a FINISHED node the same block renders read-only and is the only part of the dock
    # left standing — no field, no controls. Same tokens, no new colour: read-only is carried
    # by the absence of the controls and by the header word, never by a dimmed fill.
  stop-disclosure:
    fontSize: '{typography.body-bar.fontSize}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
  draft-item:
    padding: '{spacing.draft-item-pad}'
    controlMinSize: 24px # SC 2.5.8, NOT the dock's 32px — an 11px row cannot carry 32px
    radius: '{rounded.sm}'
    fontSize: '{typography.badge.fontSize}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
    focus-legacy: '{colors.focus-legacy}'
    focus-console: '{colors.focus-console}'
---

## Brand & Style

The transcript is a reading surface inside a room whose chrome is already settled.
It replaces two always-open blocks of JSON per tool call with one scan-line per call, so its whole aesthetic is restraint: monospace, one glyph, one coloured chip, one headline, badges at the right edge, nothing else until the reader opens a row.

Two surfaces render it and neither gets its own look.
Legacy (`WorkflowExecution` node room) inherits `packages/web/src/index.css`: hue 260, Inter, JetBrains Mono.
Console (`/console` node room) inherits `packages/web/src/experiments/console/theme.css`: hue 265, Geist, Geist Mono, brand teal as success, electric blue as running.
The row anatomy is byte-identical between the two key screens; only the `:root` block differs.
That is the visual proof of the one-presenter-two-renderers constraint, and it is the rule: the transcript never declares a colour, font, or radius that is not already a variable on the surface it sits in.

The brainstorm imports (`imports/superpowers-transcript-v1.html`, `imports/superpowers-transcript-v2.html`) settled the row anatomy but carry GitHub-dark hexes; none of those values survive.
Dark-only today, because both token sources are dark-only.

The approved Console, Legacy, transcript-state, and steering-state mockups are immutable evidence for every visible control, state, transition, and layout context.
This file defines how those visible behaviors use the product tokens and resolves only details the mockups do not show.

## Approved Current-Scope Context

The context vocabulary is exact.
`Run N` means a repeated top-level node execution.
`Iteration N` means a loop occurrence.
`Pass N` means another provider turn inside the same occurrence.
A reason-only header means an unnumbered interruption or recovery occurrence.

The visible G1, G2, and G4 behavior is current scope.
An operator row changes from `sent` to `delivered` only after provider confirmation of the same caller-stamped message id.
During generation, every queued item keeps a visible `Send now` action.
The action executes for the selected provider when its capability projection supports soft-inject.
For a queue-only provider, the action stays visible in a clear refusal state and the item stays queued.
Only G3, Grok hook soft-inject, remains deferred because it is not visible in the approved mockups.

The state, node-kind, provider, `Re-run`, Console `Log`, Legacy `Logs`, `Graph`, `Artifacts`, and room close controls are product controls.
They are not review scaffolding.
Both shells keep the same control behavior, state semantics, keyboard path, and focus result.
The shells differ only through inherited tokens, shell chrome, and the approved singular or plural log label.

## Colors

Salience runs status → chip → text.
The status glyph must be the loudest colour on the row, the family chip second, and everything else a grey.
That ordering is why the family palette has five treatments, not nine: siblings share a hue so nine distinct chips never compete with ✓ ✕ ◐ ⚠ for the eye.

**Family chips** — every hue is an existing `--node-*` token declared in `index.css` and inherited by Console.
No token is introduced on either surface.
Legend and all nine families are rendered in `mockups/key-transcript-states.html` §A and §C.

| Family       | Token                                                                | Why this hue                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shell, code  | `{colors.node-bash}`                                                 | The room already paints bash nodes amber; a shell call inside a node is the same idea one level down, and `eval` executes too. Chip text (`eval` against `run_terminal_command`) carries the distinction. |
| file, web    | `{colors.node-command}`                                              | Blue is the room's "reads a named thing" colour. A URL is a path.                                                                                                                                         |
| search, glob | `{colors.node-prompt}`                                               | Violet is the room's prompt hue; searching is asking the repo a question.                                                                                                                                 |
| todo, task   | `{colors.node-approval}`                                             | Orange is the room's human-gate colour; planning and dispatch are the agent's own coordination.                                                                                                           |
| generic      | `{colors.text-secondary-legacy}` / `{colors.text-secondary-console}` | No hue. An unknown tool must not borrow a family's meaning.                                                                                                                                               |

**`code` sharing amber is a user decision, taken after the mock review.**
The review first settled a six-treatment mapping that gave `code` its own green `--node-script`; reconciling the imports then showed that token is declared **only** in `console/theme.css:88`, whose own comment scopes it to the console "until the production palette needs them", and that `index.css` has no such token — so the mapping was not, as recorded, all-inherited.
Presented with promoting the token or folding `code` into amber, the user chose amber.
Giving `code` its own hue would mean promoting a production token and updating the brand guide with it — out of scope for a track that changes no backend and adds no token, for a family that is 3.6% of the corpus.
If Console ever replaces Legacy, `--node-script` is present by definition and splitting `code` back out is a one-line change.

**Status** — glyph colour reinforces the character, never replaces it.
✓ `{colors.success-legacy}` / `{colors.success-console}`; ✕ `{colors.error-legacy}` / `{colors.error-console}`; ◐ `{colors.running-legacy}` / `{colors.running-console}`; ⚠ `{colors.warning-legacy}` / `{colors.warning-console}`; – `{colors.text-secondary-legacy}` / `{colors.text-secondary-console}`.
Legacy has no `--running`; the ◐ glyph uses `--accent-bright`, the surface's only bright blue.
A folded-away todo call keeps the ✓ glyph at **full strength**, and the – glyph stays reserved for a genuinely unknown outcome — never for missing output, which is a badge (Components → Status glyph; read-spine AD-13).
Dimming the glyph was measured and dropped: `--success` at 55% over `--surface` gives 2.69:1 on Legacy and 3.56:1 on Console, and a 12px bold character is not large text, so both fail 4.5:1 and Legacy also falls under the 3:1 floor this document invokes for glyphs elsewhere.
The row is already subordinate through its secondary `todo updated` headline and its `op: <op>` badge, so the dimming bought redundant emphasis with the one budget the glyph could not spare.
Full strength also restores the user's own choice of glyph treatment, in which colour reinforces the character and never carries state alone.

`⚠` covers the fifth outcome, `interrupted`, and it is a fifth _character_ rather than a recoloured `✕` because the tool was **stopped**, not failed — the two need different reader responses.
`--warning` is declared on **both** surfaces (`index.css:24`, `console/theme.css:79`), so the glyph inherits with no new token; the gap that caught `code` and `--node-script` does not repeat here.
Only Claude ever produces the outcome, from the `PostToolUseFailure` hook when `is_interrupt` is true (`packages/providers/src/claude/provider.ts:952-959`) — a hook that already writes the same glyph into the output text, so the row and its body agree without extra work.
Codex cannot produce it at all: its union is `success`/`error`/`unknown` (`codex/provider.ts:644-650`).

One collision is worth naming.
On Legacy, `--warning` and `--node-bash` are the same value — `oklch(0.75 0.15 75)` at `index.css:24` and `:30` — so an interrupted **shell** row draws its `⚠` in the same amber as its own chip, the one case where the glyph does not out-shout the chip beside it.
The shape still separates them, the case is rare (Claude only, and only on a true interrupt), and the alternative is a new token this track has ruled out.
Recorded, not redesigned.

**Surfaces** — three tonal steps and no more.
`surface` is the panel.
`surface-elevated` lifts chips and subtask cards off it.
`surface-inset` sinks terminal, diff, match, path, code, and raw boxes into it.
`surface-hover` appears only on a hovered row.

**Text** — three tiers.
`text-primary` is the headline and the filename tail.
`text-secondary` is the path head, body text, assistant prose, and the generic chip.
`text-secondary` is badges, body bar, occurrence header, key-value keys, and the "todo updated" headline — everything that carries a _fact_ but is not the headline.
`text-tertiary` is the chevron, and nothing else.
The three-tier ramp therefore reads primary → secondary → _weight and rhythm_, not primary → secondary → dimmer: the folded todo row stays subordinate because its headline drops from primary to secondary while every other headline stays primary, and the badge stays quieter than the headline for the same reason.

**Inside body boxes**, four accents reuse the palette so the eye learns one vocabulary: `$` sigil in `{colors.node-bash}`, paths in `{colors.node-command}`, keywords in `{colors.node-prompt}`, strings in `{colors.success-legacy}` / `{colors.success-console}` — the same green the diff and pass lines already use.
Diff lines use success for `+` and error for `−`; `FAILED`/`ok` markers use error/success bold.

**Measured contrast** — every cell converted oklch → sRGB → relative luminance from the two token files, not estimated.
Target 4.5:1 for all transcript text, which is 10–12px.

| Pair                                                                      | Legacy    | Console   |
| ------------------------------------------------------------------------- | --------- | --------- |
| text-primary on surface                                                   | 15.3:1    | 17.7:1    |
| text-secondary on surface                                                 | 5.8:1     | 8.4:1     |
| text-tertiary on surface — chevron only, decorative                       | 2.5:1     | 4.1:1     |
| success glyph on surface                                                  | 6.3:1     | 9.5:1     |
| error glyph and `exit n` badge on surface                                 | **4.3:1** | 5.9:1     |
| running glyph on surface                                                  | 7.4:1     | 7.7:1     |
| node-bash chip on surface-elevated                                        | 7.6:1     | 7.9:1     |
| node-command chip on surface-elevated                                     | 4.8:1     | 4.9:1     |
| node-prompt chip on surface-elevated                                      | **3.7:1** | **3.9:1** |
| node-approval chip on surface-elevated                                    | 6.5:1     | 6.8:1     |
| text-secondary on surface-hover (the state a pointer reader is in)        | 5.1:1     | 7.5:1     |
| text-secondary on surface-inset (raw box, key column)                     | 6.3:1     | 8.9:1     |
| warning glyph on surface (`⚠`)                                            | 8.3:1     | 10.1:1    |
| node-prompt on surface-inset (code-body keywords)                         | **4.4:1** | **4.4:1** |
| focus ring today — Console's `--accent-ring` (30% alpha)                  | n/a       | **1.4:1** |
| focus ring today — Legacy's `outline-ring/50` (`index.css:179`)           | **2.3:1** | n/a       |
| focus ring on surface — `--accent-bright`, the token this spine specifies | 7.4:1     | 4.9:1     |
| **— the steering dock, measured this run —**                              |           |           |
| send control label, text-primary on surface-elevated (11.5px)             | 14.1:1    | 16.7:1    |
| stop control label, text-primary on surface-elevated (11.5px)             | 14.1:1    | 16.7:1    |
| `Stopping…`, text-secondary on surface-elevated (11.5px)                  | 5.3:1     | 7.9:1     |
| composer placeholder, text-secondary on surface-inset (12.5px)            | 6.3:1     | 8.9:1     |
| composer typed text, text-primary on surface-inset (12.5px)               | 16.5:1    | 18.8:1    |
| draft item, text-secondary on surface-inset (11px)                        | 6.3:1     | 8.9:1     |
| `delivered` badge, success on surface (11px)                              | 6.3:1     | 9.5:1     |
| `sent` badge, text-secondary on surface (11px)                            | 5.8:1     | 8.4:1     |
| operator prose, text-primary on surface (12.5px)                          | 15.3:1    | 17.7:1    |
| dock focus ring on surface-elevated (SC 1.4.11)                           | 6.8:1     | 4.6:1     |
| stop/send border-bright edge on surface-elevated (SC 1.4.11)              | **1.5:1** | **1.6:1** |
| send control REJECTED: primary-foreground on primary fill (11.5px)        | **3.1:1** | n/a       |

Every bold cell has a disposition.
`--node-prompt` on both backgrounds is resolved above — brightened via `color-mix` to clear 4.5:1 (owner override, 2026-09-15); the Legacy `--error` badge is likewise **brightened to clear 4.5:1** (owner decision, 2026-09-15), recorded below; the two focus rows are the departure this spine makes deliberately, explained next.

The dock's three bold cells: the **border edge at 1.5:1 / 1.6:1** takes the same disposition the Raw toggle's border already takes below — SC 1.4.11 asks for the information _required to identify_ the control, and the label at 14.1:1 / 16.7:1 does that, so the border is redundant reinforcement rather than the affordance.
The **3.1:1 row is a rejected option, not a shipped one**: it is what Legacy's send control would have measured had it inherited the shipped filled ask-card `Button`, and it is recorded because the measurement is the reason the design changed.
That shipped button is still out there — the Legacy ask card's own Submit reads 3.1:1 today — which is a production finding this run surfaces and does not own; it is recorded with the accepted shortfalls at the end of this file.
The last two rows are the exception to "used exactly as the mocks use them", and the difference matters:

**The focus ring is the one place this spine knowingly departs from the shipped surface.**
Console's `:focus-visible` is `outline: 2px solid var(--accent-ring)` (`theme.css:153-156`), and `--accent-ring` is magenta at 30% alpha (`theme.css:68`), which composites over `--surface` to **1.4:1** — under the 3:1 floor of SC 1.4.11, and a keyboard reader effectively cannot see where they are.
All three mocks quietly drew the opaque token instead, and this spine now states that on purpose: **the transcript row's focus ring is `--accent-bright`**, which is an existing token, so the no-new-token constraint holds.

That applies to **every focusable element this spine owns — the transcript row and all four focusable parts of the dock** (send control, stop control, composer field, draft item), each of which carries the token explicitly in `components`.
Over the dock's `--surface-elevated` the fixed ring measures **6.83:1 Legacy / 4.57:1 Console**, clearing SC 1.4.11.
The unfixed 1.4:1 ring remains on focusable elements **outside this panel**, which is room chrome — recorded so the next person finds it, not silently inherited.
On Legacy this means a dock control must override shadcn's `focus-visible:ring-ring/50` (`button.tsx:8`, 2.25:1) rather than inherit it.

This spine changes no token the user has ruled out changing.

## Typography

Monospace is the transcript's voice.
Rows, chips, badges, bodies, checklists, occurrence headers, and key-value lists all set `{typography.mono}` at the sizes in the frontmatter ramp.
Prose is the exception and sets `{typography.sans}` at `{typography.assistant.fontSize}` / `{typography.assistant.lineHeight}`, so sentences read as sentences between the machine's lines.
Three things qualify, and the line between them and everything else is clean: **what a human wrote (the operator's row), what a human is writing (the composer field), and what the model wrote (assistant prose)**.
Everything a machine reported stays mono.

The ramp is narrow on purpose: 12px row, 11px chip and badge, 11.5px body, 10.5px body bar and occurrence header, 10px phase label.
Two pixels separate a row from its body and a body from its bar; that is enough hierarchy for a panel 460–520px wide.

Inside the transcript, only the status glyph is bold (`{typography.glyph.fontWeight}`).
The dock's controls sit at weight 500 (`{typography.control}`), the one place in the panel that carries weight without being a fact — a control is not a fact.
A subtask's agent name is semibold (`{typography.subtask-agent.fontWeight}`); everything else is regular weight.
Uppercase with tracking marks section labels and nothing else — four of them now: the draft box header (`QUEUED · 2` / `WILL SEND · 2`) and the role labels above prose (`assistant`, `operator`) join the occurrence header (`{typography.occurrence-header.letterSpacing}`) and a todo phase label (`{typography.phase-label.letterSpacing}`).

Chip text is the tool name as the provider sent it — `read_file`, `Edit`, `Grep`, `eval` — because that is what the reader recognises; only the colour says which family it resolved to.

## Layout & Spacing

One row is one scan-line, laid out as a flex line with `{spacing.row-gap}` between five parts:

```
▸    ✓    [chip]   headline ……………………………   badges
9px  12px  auto     flex 1 · min-width 0       auto
```

The chevron and glyph are fixed columns so every chip starts at the same x.
The chip is `flex: 0 0 auto` capped at `{spacing.chip-max}` with an ellipsis inside the pill.
The cap is a guard that should never fire: a name over 24 characters is replaced by the family name upstream, in the resolver, so the pill has nothing left to truncate.
The headline takes the remaining width and must carry `min-width: 0` or it will not shrink.
Badges are `flex: 0 0 auto` and never wrap.

A path headline is two spans: a head that may shrink (`flex: 0 1 auto`) and a tail that may not (`flex: 0 0 auto`), which is how the filename survives on a narrow panel.
The head must not grow; a grow value pushes the tail away on short paths (fix recorded from the screenshot pass).

The expanded body indents `{spacing.body-indent}` — chevron plus gap plus glyph — so its `{spacing.body-rail}` rail sits directly under the chip, then pads `{spacing.body-pad-left}`.
Inside, the body bar is a flex line with the Raw button pushed to the far right by `margin-left: auto`.
Grep results flow `path:line` inline, not in a fixed line-number column; the fixed `3ch` column is for diff line numbers only.

**The transcript must not depend on a panel width.**
No shipped component pins one; the only number in the room contract is `#node-panel { width: 460px }` (`../../../specs/spec-workflow-run-view-hitl/ux-mockup/styles.css:1111`), which its Console and Legacy mockups share, and the 520px in this run's Console mock is the mock's own choice with no source behind it.
Treat 460px as the width to verify against, because it is the narrower of the two and the only one the contract states.
The transcript adapts by elision and badge priority, never by wrapping a row.
See `mockups/key-console-node-room.html` and `mockups/key-legacy-node-room.html` for the transcript at each width.

**The room stack is one rule.**
It is transcript scroller, todo strip, queue surface when non-empty, then composer dock.
The todo strip therefore sits below the transcript and immediately above the queue or dock.
In a full Legacy or Console room, the queue surface is a full-bleed band outside the dock's padded column.
In the compact dock and state-review layout, the queue surface is an inset well inside the dock.
The dock itself is a column — field, disclosures, and control row — at `{spacing.dock-pad}` with `{spacing.dock-gap}` between children.
The control row is one flex row whose stop and send controls are pushed to **opposite edges**.
That separation carries the safety property that the control that stops an agent and the control that sends to it are never a thumb's width apart.

## Elevation & Depth

No shadows.
Depth is tonal: chips and subtask cards sit on `surface-elevated`, body boxes sink to `surface-inset`, and everything else in the transcript rests on `surface`.
The dock is `surface-elevated` because it is chrome lifted off the transcript, and the composer field is a `surface-inset` well because it is written into.
The full-room queue uses `surface-elevated` as a full-bleed readout band.
The compact and state-review queue uses `surface-inset` as a contained well.
Both shapes show the same shared queue and do not change its ownership.
The body rail (`{spacing.body-rail}` of `border`) is the only line that says "this belongs to the row above".
A hovered row lifts to `surface-hover`; a focused row gets a 2px outline in the surface's focus colour and no fill.
The occurrence header's horizontal rule is `border`, 1px, and fills the width after the label.

## Shapes

`{rounded.md}` (6px) on rows, body boxes, subtask cards, and focus rings — the same 6px as the inherited `--radius-sm`.
`{rounded.sm}` (4px) on the family chip and the Raw button, matching the room's node type-pill so a chip reads as "a kind of thing", not a status.
`{rounded.full}` is reserved for the room's run and node status badges; a transcript chip is never a pill, so a family chip can never be mistaken for a status badge.
`{rounded.lg}` belongs to the room chrome and does not appear inside the transcript.

The dock takes the same two radii and adds nothing: `{rounded.md}` on the composer field, draft box, and both controls — they are boxes and rows, the same class the transcript's rows and body boxes belong to — and `{rounded.sm}` on a draft item, which is a chip-scale object.
`{rounded.full}` stays banned here too.

## Components

Visual spec only.
Behaviour is in `EXPERIENCE.md` Component Patterns.
All nine families, four hard cases, glyph row, occurrence header options, and the open Raw toggle are rendered in `mockups/key-transcript-states.html`.
The panel holds two halves: the transcript, which is read, and the **Composer dock**, which it is written from.
Everything from **Composer dock** down is the dock.

**Tool row** (`{components.tool-row}`) — a `<details>` whose `<summary>` is the scan-line; the native marker is hidden and replaced by the chevron.
Padding `{spacing.row-y} {spacing.row-x}`, radius `{rounded.md}`, `{typography.row}`.
Hover fills `surface-hover`; focus-visible draws the surface's focus outline; open rotates the chevron 90° over 120ms.

**Status glyph** (`{components.status-glyph}`) — a 12px fixed column, bold, centred: ✓ success, ✕ error, ◐ running, ⚠ interrupted, – unknown.
Five different characters; colour is added on top.

**Raw toggle** (`{components.raw-toggle}`) — its 1px `--border` measures 1.3:1 on Legacy and 1.2:1 on Console against the surface, well under the 3:1 of SC 1.4.11.
It stays, because the criterion asks for the information _required to identify_ a control, and the word `Raw` at 5.8:1 / 8.4:1 does that: the border is redundant reinforcement, in the same class as the family-chip borders.
Hover and focus raise it to `border-bright` and `text-primary`, which is where the affordance is confirmed.

**Family chip** (`{components.family-chip}`) — `{typography.chip}` on `surface-elevated`, padding `{spacing.chip-pad}`, radius `{rounded.sm}`, 1px border in the family hue mixed to 40% (search and glob 45%), text in the family hue.
The generic chip has text-secondary text and the plain `border` colour.
Max width `{spacing.chip-max}`; overflow ellipsises inside the pill, never bursts it.

**Headline** (`{components.headline}`) — text-primary, single line, end-ellipsis.
A path headline is head (text-secondary, shrinkable) plus tail (text-primary, fixed).
The folded "todo updated" headline is text-secondary — one step down from a live row's primary headline, which is what makes it subordinate.

**Badges** (`{components.badge}`) — `{typography.badge}` in text-secondary, `·`-separated.
Non-zero exit codes and `−m` use error; `+n` uses success; the word `running` uses the running colour.

**Tool body** (`{components.tool-body}`) — indent, rail, padding as specified.
Its first line is the **body bar** (`{components.body-bar}`): text-secondary facts on the left, the **Raw toggle** (`{components.raw-toggle}`) at the far right.
**The body bar opens with the resolved family**, then the family's own facts — `shell · exit 101 · 41.2s · cwd …`, `file · 1 hunk · replace_all: false`.
That one word is the only place the family is stated in text, and it is what a reader who cannot separate the chip hues has to read instead.
The chip carries the same string as a `title`, so a pointer reader gets it without opening the row.
Raw is a bordered text button, transparent fill; open state swaps to text-primary text and `border-bright`, with a `▾` suffix.

**Body box** (`{components.body-box}`) — the container for terminal, diff, matches, paths, code, web, and raw JSON: `surface-inset`, 1px `border`, radius `{rounded.md}`, `{spacing.box-pad}`, `{typography.body-text}`, text-primary content with secondary annotations, `pre-wrap`.
Terminal: `$` sigil in node-bash, `FAILED` bold error.
Diff: a `3ch` right-aligned line-number column in `{components.body-box.annotation-legacy}` / `{components.body-box.annotation-console}`, `−` lines error, `+` lines success.
Matches: path in node-command, `:line` inline in the annotation colour, then the match text.
Paths: one node-command path per line.
Code: keywords node-prompt, strings success, comments in the annotation colour; the result sits in a second box 6px below.
Raw: text-primary JSON.
Web: the requested URL as the header, the page or result title beneath it, and the body rendered as markdown — the one arm whose content is prose rather than machine output.

**Checklist** (`{components.checklist}`) — `{typography.checklist}`, text-secondary items.
Phase label is `{typography.phase-label}` uppercase text-secondary with 4px top margin.
Item glyphs: ☑ success, ◐ running colour, ⊘ warning, ☐ text-secondary, and an abandoned item is ☐ with line-through in text-secondary followed by `· dropped`.
Four shapes, so the state survives without colour.
A blocked item carries `· blocked: <reason>` in text-secondary.
The strip sits below the transcript and above the queue or dock.
On successful node completion, its terminal display can project unfinished items as complete.
On the 30-minute interruption failure, its terminal display can project the current item as pending.
These are view projections over the last provider-authored todo state and never provider todo mutations.

**Folded todo row** — a Tool row for every todo call except the last: glyph `✓` at full strength, the todo chip in `{colors.node-approval}`, headline `todo updated` in text-secondary (`{components.headline.folded-todo-legacy}` / `{components.headline.folded-todo-console}`), badge `op: <op>`.
Same height and anatomy as any other row, so it does not interrupt the scan.

**Subtask card** (`{components.subtask-card}`) — `surface-elevated`, 1px `border`, radius `{rounded.md}`, `{spacing.subcard-pad}`, 5px top margin.
Agent name in node-approval semibold, `·`, subtask name bold, `—` then prompt excerpt in text-secondary.
Batch context, when present, is one text-secondary line above the first card.
The card is itself a `<details>`, so it carries the same chevron as a tool row at `{components.chevron}` and the same 120ms rotation — closed it is the one line above, and open it adds the full prompt preformatted in a `{components.body-box}` inset within the card.
Nesting a disclosure inside a disclosure is the reason the card reuses the row's chevron rather than inventing a second affordance.

**Key-value list** (`{components.kv-list}`) — up to three rows, key in text-secondary at `{spacing.kv-key-w}`, value in text-primary; `{…}` and `[n]` are literal text.

**Context header** (`{components.occurrence-header}`) — `{typography.occurrence-header}` uppercase text-secondary label, then a 1px `border` rule to the right edge; margin `{spacing.occurrence-margin}`.
It uses `Run N` for a repeated top-level node execution, `Iteration N` for a loop occurrence, `Pass N` for another provider turn in the same occurrence, and a reason-only label for an unnumbered interruption or recovery occurrence.

**Occurrence navigator** (adopted delta 5, 2026-09-19) — one control row at the bottom edge of the room region, a sibling of the transcript scroller like the dock is, never a child of it: the `Jump to` label in `text-xs` text-secondary beside a native `<select>` that shares the header `Execution` select's anatomy verbatim — `text-xs` text, `surface-elevated` fill, 1px `border`, `rounded`, end-elided, `10rem` max width — and `Jump to latest` holding the row's right edge unchanged.
The row takes the room's existing `px-3` side padding and `py-2`; the select clears the 24px SC 2.5.8 floor through its `py-0.5` vertical padding plus border — grown, not enlarged, the way the tool row reaches it — so its painted anatomy stays the header select's.
It renders only while two or more displayable occurrence groups exist; its absent state is the absent control — the row itself can still stand for `Jump to latest` alone — never a disabled control, and the transcript declares no breakpoint for it: under the host room's small-viewport layout the select shrinks with end-elision exactly as the `Execution` select does in the header.

**Assistant text** (`{components.assistant-text}`) — sans, text-secondary, with a 10px uppercase text-secondary `assistant` role label above it on the room screens.
Inline code inside it is mono at 11px.

**Operator text** (`{components.operator-text}`) — the same anatomy as Assistant text, one step up: sans, **text-primary**, under a 10px uppercase text-secondary `operator` role label.
Two channels separate the operator's words from the model's, and neither is a hue: the label says who wrote it — and on a node with more than one operator that label names the **sender** (`operator_user_id`) rather than a bare `operator`, still in the same `{components.operator-text.label}` token, so distinguishing operators adds no colour — and full-strength text against the model's secondary says it a second time.
A reader who can distinguish no colour at all still cannot confuse them.
A message-status badge sits on the label line, right-aligned.

**Message status** (`{components.message-status}`) — `{typography.badge}`, the words `sent` and `delivered`, never a dot and never a colour alone.
`sent` is text-secondary.
`delivered` takes the success colour **in addition to** the word and appears only after the provider confirms the same caller-stamped message id.
Request acceptance, matching text, and timing never produce `delivered`.

**Composer dock** (`{components.composer-dock}`) — pinned to the bottom of the node panel on both shells, `surface-elevated` with a 1px `border` top edge, padding `{spacing.dock-pad}`, children `{spacing.dock-gap}` apart.
The full-room stack is transcript, todo strip, full-bleed queue band when non-empty, then dock.
The compact and state-review stack keeps the queue as an inset well inside the dock.
The remaining dock order is stop disclosure when present, composer field, then one control row.
In the finished-iteration mode the stack is one flex/control row (disclosure + Go) then the read-only queue surface for that layout.
The control row puts the **Stop control** at the left edge and the **Send control** at the right, pushed apart by the full dock width.
That gap is the point — the recoverable-but-disruptive control and the primary control must never sit under the same thumb.

**Composer field** (`{components.composer-field}`) — a `surface-inset` textarea, 1px `border`, radius `{rounded.md}`, min-height `{spacing.composer-min-h}`, set in the same sans face and size as assistant and operator prose.
It is written in, so it is set the way it will be read.

**Send control** (`{components.send-control}`) — bordered on both shells: transparent fill, `border-bright`, text-primary, the fixed focus ring.
The label is the state: `Queue` while the agent generates, `Send now` while the agent is idle-after-interrupt.
Nothing else about the control changes between the two — **same box, same position, and a width held to the wider of the two labels** — because a control that moves or resizes as well as renames is two controls, and the operator's pointer is already travelling toward the first one.
An earlier draft inherited Legacy's shipped filled ask-card `Button` instead, so that the operator would meet a button they already knew.
It was reversed on measurement: `--primary-foreground` on `--primary` is **3.06:1**, and an 11.5px label needs 4.5:1.
Bordered measures **14.08:1 / 16.72:1**.
Primacy is carried by the right-edge position, which is enough in a row that holds two controls.

**Stop control** (`{components.stop-control}`) — bordered on both shells, transparent fill, `border-bright`, text-primary, the fixed focus ring.
It interrupts the **agent** and leaves the node `running` — the whole-node teardown is the separate **Cancel** button, not this control.
Never filled, and never in the error colour: an interrupt leaves the agent able to continue, and painting it red would report a failure that did not happen.
Reads `Stop`, then — if the sub-second `Stopping…` transient is shown — `Stopping…` while the interrupt is in flight.
**`Stopping…` is `aria-disabled`, never the `disabled` attribute, and dims no further than text-secondary.**
Both halves of that are one decision.
The native attribute blurs the element that carries it, so a keyboard operator who presses `Stop` is returned to `<body>` — and then to the _top_ of the document, with the whole transcript between them and the dock, however brief the interrupt is.
Keeping it focusable also means the SC 1.4.3 inactive-component exemption is no longer being leaned on, which is why the dim floor is `--text-secondary` (**5.33:1 / 7.90:1**) rather than tertiary (**2.31:1 / 3.88:1**).
The requirement was always "it may not disappear"; secondary does not make it disappear.

**Queue surface** (`{components.draft-box}`) — rendered only when it holds something, never as an empty shell.
In the full Legacy and Console rooms it is a **full-width `surface-elevated` band** with a 1px top rule, directly above the composer dock and directly below the todo strip.
In the compact dock and state-review layout it is a `surface-inset` well inside the dock.
These two approved shapes represent the same server queue.
Its header is a `{typography.phase-label}` uppercase text-secondary word plus a count: `QUEUED · 2` while the agent generates, `WILL SEND · 2` while the agent is idle-after-interrupt.
That one word is the whole signal that the control below has changed meaning, so it is a heading, not a caption.
The header is a disclosure control.
Each item shows its 1-based receipt ordinal, and the next item out uses the same inset running mark as the current todo item.
Scrolls internally past `33vh`; the dock never grows to swallow the transcript.
Only unsent composer content can show `this tab only`, including when the compact layout places draft and queue content in one combined visual surface.
Accepted queue items are node-scoped and shared across tabs and operators.

**Stop disclosure** (`{components.stop-disclosure}`) — one line of `{typography.body-bar}` text-secondary between the draft box and the field, rendered only while the agent is idle-after-interrupt: `stopped after the last completed tool call · files already written stay written`.
It is a slot in the dock's anatomy rather than a caption on another component, because it is the one place the interface corrects a belief the operator is likely to hold, and a caption can be dropped by someone rearranging the thing it hangs off.

**Queue item** (`{components.draft-item}`) — one line per waiting message, `{typography.badge}` text-secondary, end-elided, radius `{rounded.sm}`.
During generation, every item shows `Send now` and delete at the row's right edge.
When the selected provider supports soft-inject, `Send now` sends only that item into the active turn.
When the selected provider is queue-only, `Send now` remains visible in a refusal state with text that explains that this provider waits for the next turn; activation does not remove or deliver the item.
Per-item controls clear the 24×24 SC 2.5.8 floor through padding — not the dock's 32px, which an 11px row cannot carry without becoming a card.

**Finished-iteration dock (Story 2.10 / AD-16, issue #190 decision B2 — adopted 2026-09-20).**
When the operator is viewing a completed iteration of a still-live loop node through the `Execution` selection controls, the composer dock swaps to a read-only mode rather than disappearing:

1. **One flex/control row** at the dock's top (same `{spacing.dock-pad}` / `{spacing.dock-gap}` rhythm as the live dock): a flexible disclosure cell on the left carrying the complete copy `reading a finished iteration · the agent is working in iteration N` in `{typography.body-bar}` text-secondary, and a native `Go to iteration N` button on the right.
2. **At the authoritative 460px room width** the complete disclosure **may wrap** inside its flexible cell so every word stays visible; the Go button remains fully visible, at least `{spacing.control-min-h}` **32px** high, and never compresses under the text.
   There is **no horizontal overflow** of the row or the dock.
3. **Queue band below the control row** — the same queue anatomy as the active layout (`surface-elevated` full-bleed in a full room, `surface-inset` well in compact/state-review), with `QUEUED · n` / `sent` labels and internal scroll past `33vh`.
   It renders only when the shared pending queue has `sent.length > 0`.
   It is read-only: no textarea, send, withdraw, or interrupt control is offered.
4. DOM order is disclosure → Go → optional detached/alert line → band.
   Focus never lands on `<body>`.

Every iteration-scoped mutation carries the selected `retry_epoch`.
The server rejects a stale or finished epoch before mutation, so a stale client fails closed even though the approved finished-iteration mode exposes no mutation control.

**Room context and chrome controls** — the approved state, node-kind, provider, `Re-run`, Console `Log`, Legacy `Logs`, `Graph`, `Artifacts`, and close controls are current product behavior.
They use the existing room control sizes and focus tokens.
State, node-kind, provider, and execution selection remain synchronized with the displayed transcript, todo projection, queue, and dock.
Changing provider changes the real capability projection used by per-item `Send now`; it does not simulate support.
Close returns focus to the control or row that opened the room.

**Interaction and accessibility** — native buttons and selects keep their platform keyboard behavior.
`Tab` follows DOM and reading order.
`Enter` and `Space` activate buttons and transcript disclosures, while a bare `Enter` in the composer inserts a newline.
`Cmd`/`Ctrl`+`Enter` uses the same permission and refusal check as the visible send control.
When an active control unmounts, focus moves to its direct successor or owning selector and never to `<body>`.
At 460px, context selectors can wrap in source order, text can wrap or elide only where this file permits, safety controls stay at opposite edges, the Go button remains fully visible, and no horizontal overflow appears.
Under `prefers-reduced-motion`, disclosure rotation, smooth scrolling, and dock motion are disabled.
Idle-after-interrupt shows the 30-minute inactivity rule and the copy `no redirect ends this node after 30 min of inactivity · typing keeps it open`.
Authorized typing activity sends the debounced composing keepalive and re-arms the timer.
`Send now`, Cancel, or timer expiry resolves the idle wait exactly once.
No countdown is shown.
Every refusal stays visible, preserves the operator's content and focus, and exposes its reason in text and through an accessible description.
Both shells use these exact rules.

This is deliberately a thin parallel treatment in each shell's own dock renderer (no cross-surface abstraction).
Elision of the disclosure string is **not** authorized; wrapping inside the flex cell is the approved narrow-width answer.

## Do's and Don'ts

| Do                                                                       | Don't                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Resolve every colour to an existing `--*` variable on the surface        | Carry a GitHub-dark hex from the brainstorm imports                 |
| Keep the row anatomy identical on both surfaces; vary only `:root`       | Give Console or Legacy a different chevron, glyph, or chip shape    |
| Let the status glyph out-shout the chip, and the chip out-shout the text | Add a sixth chip treatment or split a sibling pair onto its own hue |
| Show the ✓ ✕ ◐ ⚠ – character and colour it                               | Encode outcome in colour alone, a dot, or a left bar                |
| Elide paths in the middle so the filename survives                       | Tail-cut a path                                                     |
| Cap the chip at `{spacing.chip-max}` and ellipsise inside it             | Let a Codex command or MCP name burst the chip                      |
| Sink bodies to `surface-inset`, lift chips to `surface-elevated`         | Use shadows, gradients, or the brand gradient inside the transcript |
| Use `{rounded.sm}` on chips, `{rounded.md}` on rows and boxes            | Use `{rounded.full}` on anything in the transcript                  |
| Keep raw JSON in a text-secondary body box behind Raw                    | Render JSON as a default presentation anywhere on the row or body   |
| Set assistant prose in sans                                              | Set tool rows, chips, or badges in sans                             |
| Set the operator's prose one strength above the model's                  | Separate the two by hue, avatar, or bubble                          |
| Keep the send control's box, size, and position fixed as its label flips | Move or restyle it between `Queue` and `Send now`                   |
| Draw the stop control bordered, in text-primary                          | Fill it, or colour it with `error` — a stop is not a failure        |
| Render the draft box only when it holds something                        | Show an empty queue panel above the composer                        |
| Put the stop and the send at opposite ends of the control row            | Set them side by side, where the wrong one is one thumb away        |
| Keep per-item `Send now` visible and explain a queue-only refusal        | Hide the action because the selected provider cannot soft-inject    |
| Put the todo strip below the transcript and above the queue or dock      | Put the todo strip at the top of the transcript                     |

## Open Questions

**One, and it is narrow.**
`--node-prompt` is the only family hue that falls short, and it does so on both backgrounds it is drawn against: **3.7:1 / 3.9:1** as chip text on `surface-elevated`, and **4.4:1 / 4.4:1** as code-body keywords on `surface-inset`.
Both are 11px or smaller, so 4.5:1 applies to each.
Every other hue clears it: `--node-command` clears it at 4.8:1 / 4.9:1, `--node-approval` at 6.5:1 / 6.8:1, `--node-bash` at 7.6:1 / 7.9:1, and `generic` sits in `--text-secondary` at 5.8:1 / 8.4:1.
So this is one token in two places — the `search` and `glob` chips, and the keywords inside a `code` body — not the palette.

The tier decision does not reach it.
Every other transcript fact moved to `--text-secondary`, but here the colour **is** the content: on the chip it is the family, in the code body it is the syntax class.
Recolouring either to grey would delete the meaning the colour exists to carry, and the family-hue system is a user decision.

Two ways out, both inside the no-new-token rule:

- **Brighten the token where it carries text** with `color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))`, keeping the pure hue on the chip border so the violet identity survives.
  Clears 4.5:1 on both backgrounds and touches nothing else.
- **Accept, and record it** — the chip is a redundant label (the tool name sits inside it, and the family is also in the body bar, the accessible name and the `title`), and a keyword that reads as body text still reads: the code is legible at `--text-primary`, only its syntax highlighting is muted.

This one was carried into the finalize pass by mistake: it was folded into a renumbering and marked resolved when nothing had resolved it.
Recorded as open rather than quietly accepted.

**Resolved (owner override, 2026-09-15): brighten.**
The owner directed the fix over the "accept and record" recommendation this document had reached, because NFR8 declares WCAG 2.2 AA as the floor and a sub-4.5:1 text role contradicts it.
Both text placements — the `search`/`glob` chip text and the `code`-body keywords — take `color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))`; the pure `--node-prompt` stays on the chip border so the violet identity survives.
This clears 4.5:1 on both backgrounds and touches nothing else.
**Disposition:** an inline derived value composed from two existing tokens — NOT a new named token, so the no-new-token/brand rule holds.
Do not promote it to a named `--node-prompt-text` token: that would re-trigger the brand-guide update rule and reverse this decision.
(The counter below already noted `color-mix` is how every chip border is drawn, so the derivation precedent exists.)

The honest counter, so the choice is a real one: `color-mix` is **already** how this design draws every chip border, five times in the states sheet alone, so the precedent for deriving a value from tokens exists and the third argument above is the weakest of the three.
If the transcript ever has to pass an audit rather than serve a developer, brightening is the answer that survives it.

This question is now resolved, above (owner override, 2026-09-15).
Everything else this run opened is answered, and what follows is the record.

**Resolved during finalize**, from the accessibility review, from live code, and from three user decisions:

- **Every transcript fact moved from `--text-tertiary` to `--text-secondary`, on both surfaces** — a user decision, taken with the measurements in hand.
  `--text-tertiary` carried every badge, body bar, occurrence header and key name at 10–11.5px, where 4.5:1 applies without argument, and it measured 2.53:1 on Legacy and 4.07:1 on Console resting, worse on hover.
  The headline beside a failing badge passes at 15.3:1, so the effect was exact: a reader with low contrast sensitivity got the command and not the result.
  `--text-secondary` clears the floor everywhere (5.82:1 / 8.37:1) and is an existing token, so the no-new-token constraint holds.
  `--text-tertiary` now has exactly one use, the chevron, which is decoration hidden from assistive technology.
  The third tonal step is replaced by the primary-to-secondary headline drop and by the `·` rhythm.
- The `exit 101` badge is brought to the WCAG 2.2 AA floor (owner decision, 2026-09-15, reversing the earlier accept): the word `exit` and the duration moved to `--text-secondary` with the tier decision, and the digits' `--error` on Legacy is **brightened to clear 4.5:1** via a token-derived `color-mix` (mirroring the `--node-prompt` fix; no new named token).
  The implementer measures the mix on both backgrounds and records the cell; the prior 4.3:1 Legacy value is superseded.
  The `✕` glyph continues to carry the same fact beside it.
- **The Raw toggle and the interactive tool row both clear SC 2.5.8 at `min-height: 24px`** — the row is grown from 22px to 24px (owner decision, 2026-09-15, reversing the earlier accept).
  Both grow through **padding**, so the painted box does not change and transcript density is preserved.
  Raw was always the target that genuinely missed SC 2.5.8 (about 15–17px, at the far right of the body bar, near the panel's drag-to-resize edge); the row's former 2px shortfall is now closed rather than accepted.
- **The family reaches a colour-blind reader through the body bar and a tooltip, not a chip prefix** — a user decision.
  A prefix would have cost row width on the one line that must never wrap, and at 460px the path headline pays first.
  See **Components → Tool body**.
- **The shipped Legacy ask-card `Submit` measures 3.1:1 and this run does not own it.**
  Surfaced by measuring the send control: `--primary-foreground` on `--primary` is 3.1:1 on a small label, and `AskCard.tsx:377` ships exactly that pairing today.
  The dock avoided it by specifying a bordered control instead.
  The ask card is outside this spine's scope, so the finding is recorded here rather than fixed — someone should carry it to whoever owns that component.
- `interrupted` takes `⚠` in `--warning` — see **Colors → Status**.
- The Console focus ring is `--accent-bright`, opaque, **not** `--accent-ring`.
  The frontmatter previously named the 30%-alpha glow token, which composites to 1.35:1 over `--surface` and would leave every keyboard user on the default route without a visible position.
  The mocks always used the opaque token at 4.85:1; the spine now agrees with them.
- The folded-todo `✓` renders at full strength.
  Dimming it to 55% measured 2.69:1 on Legacy and 3.56:1 on Console — see **Colors → Status**.
