# Spine Pair Review — Archon (readable agent transcript)

## Reviewed against

The spines changed three times during this walk. Every finding below is against this snapshot.

| File                                                 | Modified                         |
| ---------------------------------------------------- | -------------------------------- |
| `DESIGN.md`                                          | 2026-09-10 00:26:12              |
| `EXPERIENCE.md`                                      | 2026-09-10 00:26:12              |
| `.memlog.md`                                         | 2026-09-10 00:24:27 (44 entries) |
| `mockups/key-transcript-states.html`                 | 2026-09-10 00:26:12              |
| `mockups/key-console-node-room.html`                 | 2026-09-10 00:00:26              |
| `mockups/key-legacy-node-room.html`                  | 2026-09-10 00:00:26              |
| `imports/superpowers-transcript-v1.html`, `-v2.html` | 2026-09-09 23:28:30              |

Line numbers are secondary. Each finding quotes the text, because the line numbers moved while this
walk ran.

**Memlog order was checked first.** Entry 36 (`User pick (b)`) supersedes entries 18 and 23 under the
append-only later-wins rule. `DESIGN.md` Colors, the frontmatter key `family-chip.code`, and states
sheet §A all agree: five chip treatments, `code` shares `--node-bash`. There is no contradiction here.
Do not report one.

The accessibility lens returned at approximately 00:26 and its changes are already applied. This walk
covers the post-accessibility text.

## Overall verdict

The token layer is the strongest part of this pair, and it is verifiably correct: 89 distinct
`{path.to.token}` references over 236 defined paths resolve with zero misses, and an independent
recomputation of all 20 published contrast ratios from the oklch declarations reproduces every cell.
The weak part is the transcript's relation to the room around it. The Information Architecture section
states a surface difference in occurrence filtering that the shipped code contradicts, and the whole
`Run N` occurrence header — the reader-visible payoff of CAP-6 — depends on that statement. Three more
faults are stale text: a decision was resolved in one section and its earlier assumption was left
standing in another, so a builder finds two answers to the same question.

Coverage has one true hole. The `web` family has a colour, a chip, and a collapsed row, and it has no
expanded body in either spine or in the mock that claims one body per family.

## Blocking

A downstream builder would build the wrong thing from each of these.

- **B1** — Occurrence filtering: the IA claim is contradicted by the shipped fetch path (§7, §1).
- **B2** — Chip label: "ellipsis in the pill" and "render the family name" both stated as the rule (§3).
- **B3** — Full-output control: two homes stated, in three places (§3, §4).
- **B4** — Arrow keys: assumption and resolution both stand (§4).
- **B5** — The `⚠` glyph did not reach `DESIGN.md` Components or Do's and Don'ts (§3).
- **B6** — The `web` family has no body arm anywhere (§3).

## 1. Flow coverage — adequate

Checked: `sources:` frontmatter of both spines resolves to `SPEC.md`, the two contracts, the HITL
mockup README, and `project-context.md`. All seven capability names (CAP-1 … CAP-7) come from
`SPEC.md` and are used verbatim. Three Key Flows exist. Each has a named protagonist (Kevin, Kevin,
Dale), numbered steps, one bolded `**Climax:**` beat, and a `Failure:` line.

### Findings

- **critical** Flow 2 rests on B1. Step 2 and step 3 read: "They click `run 2`; the panel header shows
  `runs 1 [2]`." then "The transcript lists `Run 1 · failed` with its `✕` row still open, then
  `Run 2 · retry`." Under an occurrence chip the messages request carries `occurrenceId`, so Run 1's
  rows are not in the payload. See B1 in §7 for the evidence. _Fix:_ settle B1, then re-walk Flow 2
  steps 2–3 against the answer.
- **medium** CAP-4 is claimed but never walked. The header states "CAP-2, CAP-3, CAP-4 in Flow 1", and
  Flow 1 step 3 shows only the collapsed row — "a `task` row reading `2 subagents · 2m 04s`". CAP-4's
  success text in `SPEC.md` is "one collapsible card per subtask naming the subtask and its agent". No
  flow opens a task row. _Fix:_ extend one flow through the opened subtask card, or drop CAP-4 from the
  coverage claim.
- **low** "CAP-1 and CAP-6 in every flow" is false for Flow 3. Flow 3 has five steps and none names an
  occurrence, a `Run N` header, or an `Iteration N` header. _Fix:_ correct the coverage line.
- **low** The protagonists carry no context. Flow 3 gives "Dale, who started the run"; Flows 1 and 2
  give "Kevin" alone. _Fix:_ add the role that makes each reader's need concrete.

## 2. Token completeness — strong

Checked mechanically. Frontmatter parsed to 236 token paths. Both spines scanned for `{path.to.token}`
references: 89 distinct, 220 occurrences, **zero unresolved**. Every colour token carries a hex, and
every hex carries the source variable name and its declaration site in a comment.

Verified independently, not taken on trust:

- Every `--node-*` claim matches source. `index.css:28` `--node-command`, `:29` `--node-prompt`, `:30`
  `--node-bash`, `:32` `--node-approval`. `console/theme.css:85` states the five node tokens inherit,
  so "Console inherits" holds.
- Every one of the 26 hex values reproduces from the oklch declaration through the standard OKLab to
  sRGB transform. No hex is wrong.
- All 20 cells of the "Measured contrast" table reproduce to the stated precision under the WCAG
  relative-luminance formula. `DESIGN.md` says of these numbers "the numbers above come from a single
  unverified pass". They are no longer unverified. The accessibility lens owns the verdict on what the
  shortfalls mean; this is corroboration of the arithmetic only.

### Findings

- **medium** The `interrupted` badge has no colour token. State Patterns introduces "badge
  `interrupted`", and the frontmatter `badge` object defines `exit-nonzero-*`, `added-*`, `removed-*`
  and `running-*` but no `interrupted-*` pair. The glyph got its pair (`status-glyph.interrupted-legacy`
  / `-console`); the badge did not. _Fix:_ record the badge colour decision, or state that the
  interrupted badge takes the default tertiary badge text.
- **low** `focus-console: '#E400DE'` overstates the ring. The comment reads "`--accent-ring` = brand
  magenta at 30% alpha", and `console/theme.css:68` declares `oklch(0.64 0.295 330 / 0.3)`. The hex
  drops the alpha, so a builder who mirrors the hex draws an opaque ring. The memlog's last entry says
  the accessibility lens renamed this token to `--accent-bright`; the frontmatter still carries the
  `--accent-ring` comment and the magenta hex. _Fix:_ bring the hex, the comment and the variable name
  into agreement.
- **low** Three defined tokens are never referenced by `{ref}`: `colors.surface-legacy`,
  `colors.surface-console`, `spacing.chevron-w`. Prose names them bare instead — "`surface` is the
  panel", "9px". Not a defect; noted so a mechanical extractor does not report them as dead.

## 3. Component coverage — thin

Checked: every component named in either spine, in both directions. 14 frontmatter component objects,
13 named blocks in `DESIGN.md` Components, 20 rows in `EXPERIENCE.md` Component Patterns. Names match
across both files.

### Findings

- **critical (B6)** The `web` family has no body arm. The frontmatter assigns it a colour —
  `web: '{colors.node-command}'` — and states sheet §C shows a collapsed `WebFetch` row. Then:
  `DESIGN.md` Components says the body box is "the container for terminal, diff, matches, paths, code,
  and raw JSON"; `EXPERIENCE.md` Component Patterns holds `Body box: terminal | diff | matches | paths
| code | raw` and no web row; states sheet §D is headed "Expanded bodies — one per family" and holds
  nine captions covering shell, file, search, glob, code, todo twice and task twice — no web. The
  upstream contract does declare one: `tool-presentation-contract.md` Expanded body table, row `web`,
  "url and title, output as markdown". A builder opening a `WebFetch` row has no rule. _Fix:_ add a
  `Body box: web` row to Component Patterns and its visual arm to `DESIGN.md` Components, or state
  which existing arm `web` uses.
- **critical (B5)** The `⚠` glyph did not reach two `DESIGN.md` sections. Colors → Status now lists five
  glyphs and gives the rationale. Components still reads "✓ success, ✕ error, ◐ running, – tertiary."
  followed by "Four different characters; colour is added on top." Do's and Don'ts still reads "Show the
  ✓ ✕ ◐ – character and colour it". `EXPERIENCE.md` Accessibility Floor says "`✓ ✕ ◐ ⚠ –` are five
  different shapes". Components is the section a builder implements. _Fix:_ propagate the fifth glyph
  into `DESIGN.md` Components and Do's and Don'ts.
- **critical (B2)** Two chip-label rules stand. `EXPERIENCE.md` State Patterns is explicit: "**The chip
  renders the family name**, per `tool-presentation-contract.md`. `get_command_or_subagent_output` is 30
  characters, so its chip reads `generic`. The 24ch CSS cap is a defence-in-depth guard, not the
  mechanism — if an ellipsis ever appears inside a pill, the resolver failed to apply the fallback."
  Three other places still make the ellipsis the normal behaviour: Component Patterns, Family chip —
  "Ellipsises inside the pill past `{spacing.chip-max}`"; Elision and badge priority, step 1 — "**Chip**
  caps at `{spacing.chip-max}` and ellipsises inside the pill"; `DESIGN.md` Components — "Max width
  `{spacing.chip-max}`; overflow ellipsises inside the pill, never bursts it"; `DESIGN.md` Do's — "Cap
  the chip at `{spacing.chip-max}` and ellipsise inside it". Note also that the two rules count
  different things: the contract counts characters of the tool name, `{spacing.chip-max}` is a CSS
  width of `24ch`. _Fix:_ keep one rule, and state the CSS cap's role at every site that mentions it.
  Re-check states sheet §C hard case 4, which was regenerated during this walk.
- **critical (B3)** The full-output control has two homes. Component Patterns, Body bar: "[ASSUMPTION]
  The existing full-output load control (`canLoadFullOutput` / `onLoadFullOutput`) sits in the body bar
  beside Raw when `outputState` is `truncated`." State Patterns, Output truncated: "the full-output
  control keeps the position it has today — a text button under the output block … so it does not join
  Raw in the body bar". The resolved table repeats the second: "Where it is today, under the output
  block." Flow 3's failure line repeats the first: "the full-output load control in the body bar
  fetches the rest". Memlog entry 41 records the decision as "under the output block". _Fix:_ delete the
  superseded assumption at Body bar and correct the Flow 3 failure line.
- **high** The subtask card is collapsible with no visual disclosure spec. Component Patterns:
  "[ASSUMPTION] Cards are collapsible per the contract; expanded shows the full prompt preformatted."
  `DESIGN.md` Components, Subtask card, gives surface, border, radius, padding, top margin, agent
  colour and weight, and the excerpt colour — and no toggle affordance and no expanded appearance. The
  upstream contract requires it: `SPEC.md` CAP-4, "one collapsible card per subtask". _Fix:_ add the
  disclosure affordance and the expanded state to the Subtask card visual spec.
- **medium** The Raw button has no hover state and no focus appearance. `DESIGN.md` gives it default and
  open only — "Raw is a bordered text button, transparent fill; open state swaps to text-primary text
  and `border-bright`, with a `▾` suffix" — and the frontmatter `raw-toggle` object holds no hover or
  focus key. The Tool row gets both: "Hover fills `surface-hover`; focus-visible draws the surface's
  focus outline". Raw is the transcript's only other interactive control. _Fix:_ add hover and
  focus-visible to the Raw toggle spec, or state that it inherits the row's focus treatment.

## 4. State coverage — adequate

Checked: every IA surface against the states the rubric names. The State Patterns table holds 30 rows
and is the most complete part of `EXPERIENCE.md`. Empty, cold load, running, completed, failed,
connection lost and permission denied are all covered for the Transcript. The Tool row covers
succeeded, failed, running, unknown, output missing, truncated, interrupted, hover and focus.

### Findings

- **critical (B4)** Two keyboard rules stand. Interaction Primitives: "[ASSUMPTION] `↑` / `↓` move focus
  between rows, matching the existing details/summary behaviour today." Accessibility Floor:
  "**Row-to-row movement is `Tab`, and arrow keys do nothing.**" The resolved table agrees with the
  second, and memlog entry 42 records it. _Fix:_ delete the superseded assumption from Interaction
  Primitives.
- **high** An open row whose result has not arrived has no rule. Tool running says only "Collapsed,
  glyph `◐`, badge `running · <elapsed>`". The row is a native `<details>`, so the reader can open it,
  and Flow 1 step 7 ends with a `◐` row the reader keeps. Nothing states what the body holds when there
  is no output — an empty terminal box, a partial one, or the body bar alone. _Fix:_ add a state row for
  an expanded row with no result yet.
- **high** The iteration filter and the occurrence header collide. Information Architecture states that
  the Legacy chips "cut the message list down to one iteration … but only for an **iteration** chip".
  Component Patterns states the header is "Rendered only when a node spans more than one
  `occurrence_id`", and State Patterns confirms "Single occurrence | Transcript | No occurrence header."
  So selecting iteration 2 removes the `Iteration 2` label from the transcript. Both rules are
  deterministic; the intent is not recorded. _Fix:_ record what the header does under an active
  iteration filter.
- **medium** The transcript has no load-error state. Cold load and connection lost are covered.
  A failed fetch of the node's messages is not. _Fix:_ add the state, or state that it stays the room's.
- **medium** One assumption has no matching Open Question. Interaction Primitives: "[ASSUMPTION] Raw is
  a button at the far right of the expanded body's first line … Recorded as an assumption at mock time
  and not among the decisions confirmed at review." Open Question 1 asks how Raw behaves when open, not
  where it sits. _Fix:_ triage the placement assumption into the Open Questions list or confirm it.

## 5. Visual reference coverage — strong

Checked: all five files under `mockups/` and `imports/`. `wireframes/` does not exist.

| File                                     | Linked from                                    | Named purpose |
| ---------------------------------------- | ---------------------------------------------- | ------------- |
| `mockups/key-console-node-room.html`     | `EXPERIENCE.md` IA, `DESIGN.md` Layout, Flow 1 | yes           |
| `mockups/key-legacy-node-room.html`      | `EXPERIENCE.md` IA, `DESIGN.md` Layout, Flow 2 | yes           |
| `mockups/key-transcript-states.html`     | both spines, with §A, §C, §E, §F anchors       | yes           |
| `imports/superpowers-transcript-v1.html` | `DESIGN.md` Brand & Style, Inspiration         | yes           |
| `imports/superpowers-transcript-v2.html` | `DESIGN.md` Brand & Style, Inspiration         | yes           |

No orphans. Spines-win-on-conflict is stated once in each file — `DESIGN.md`: "Where this file
disagrees with any mock, wireframe, or import, this file wins."

### Findings

- **low** §D is never cited by anchor. §A, §C, §E and §F are cited by section; §D, which holds the
  expanded bodies, is reachable only through the unanchored sentence "All nine families, four hard
  cases, glyph row, occurrence header options, and the open Raw toggle are rendered in
  `mockups/key-transcript-states.html`". _Fix:_ cite §D from Component Patterns' body-box rows.
- **low** The states sheet §E option 1 mixes the two vocabularies. It renders `Run 1`, `Run 2 · retry`,
  `Run 3 · iteration 2`. The Occurrence grouping table gives loop-driven groups `Iteration N` with no
  suffix. The spine wins, so this is a mock artefact. _Fix:_ none needed; noted so it is not read as a
  third rule.
- **low** The two room mocks are 26 minutes older than the spines (00:00:26 against 00:26:12). They
  predate the `⚠` glyph, the full-strength folded todo and the badge-reappearance rule. They are still
  correct for what they illustrate. _Fix:_ none; noted for the next mock pass.

## 6. Bloat & overspecification — strong

The pair is lean for its subject. Neither file restates personas, functional requirements or scope from
`SPEC.md`. Tables carry the rules; prose carries only the reasons. `DESIGN.md` uses editorial voice,
which its spec allows; `EXPERIENCE.md` does not.

### Findings

- **low** The elision and badge rule is stated three times: Component Patterns rows Headline and Badges,
  Responsive & Platform "Pressure order as the panel narrows", and the whole section Elision and badge
  priority. _Fix:_ keep the section, and make the other two point to it.
- **low** "Provider normalization at the edge" partly restates what the spine says it cites. The header
  of the file states the machine contract "is cited, not restated". Two of its five bullets repeat
  `tool-presentation-contract.md` closely — the todo and task normalizers, and the `path` reversal in
  the two glob tools. _Fix:_ keep the reader-visible consequence, cite the mechanism.
- **low** Pixel literals appear in Components prose where no token holds them: "a 10px uppercase
  tertiary `assistant` role label", "Inline code inside it is mono at 11px", "5px top margin", "the
  result sits in a second box 6px below", "with 4px top margin", "a `3ch` right-aligned tertiary
  line-number column", "rotates the chevron 90° over 120ms". _Fix:_ add the load-bearing ones to the
  spacing and typography scales, or accept them as one-offs.
- **low** `DESIGN.md` prose names surface and text tokens without the surface suffix — "`surface` is the
  panel", "`surface-elevated` lifts chips", "1px `border`" — while the frontmatter defines them per
  surface (`surface-elevated-legacy` and `-console`). The component objects carry both, so the ambiguity
  is recoverable. _Fix:_ none required; noted for a mechanical extractor.

## 7. Inheritance discipline — thin

Checked: all seven `sources:` paths in `DESIGN.md` and all five in `EXPERIENCE.md` resolve on disk.
Capability names are verbatim. The glossary — the nine family names, occurrence, attempt, headline,
chip, badge — is identical across both spines and the contracts. Component names match across all
sections of both files. Every `EXPERIENCE.md` token reference resolves to a `DESIGN.md` token.

### Findings

- **critical (B1)** The occurrence-filtering claim is contradicted by the code it cites, and a decision
  taken minutes ago rests on it. `EXPERIENCE.md` Information Architecture states: "An **occurrence** or
  node selection returns the full ordered list, unfiltered. So the HITL README's "scoped to exactly that
  run" describes the iteration case only, and the transcript keeps listing every occurrence under an
  occurrence chip." What the code shows:
  - `selectNodeRoomMessages` does return `ordered` for an occurrence selection, and the sibling copy at
    `packages/web/src/experiments/console/components/inspect/select-node-room-messages.ts:12` says why:
    `// occurrence-scoped: server already filtered by occurrence_id/attempt_id`.
  - Both rooms scope the request. `ConsoleNodeRoom.tsx:418-433` and `WorkflowExecution.tsx:358-370`
    build `{ kind: 'occurrence', occurrenceId, attemptId? }` from the selected log row, and
    `lib/api.ts:719` and `experiments/console/skills/runs.ts:127` put `occurrenceId` on the query
    string.
    So the absence of a client-side second pass is not the absence of filtering. Under an occurrence chip
    the payload holds one occurrence, and by Component Patterns' own rule no header renders. The earlier
    check missed this because it read `selectNodeRoomMessages` alone and did not follow the fetch. This is
    new evidence, not a counter-argument: it names two files the recorded decision does not cite.
    _Fix:_ re-open memlog entry 39 against the fetch path, then correct Information Architecture, the
    resolved table and Flow 2. Do not assume the answer either way.
- **critical (B1, second locator)** "Console does not filter at all" is false. `EXPERIENCE.md` states:
  "Console does not filter at all: it renders every iteration as its own `<details>` and opens the
  selected one (`ConsoleNodeRoom.tsx:379-400`). **The two surfaces genuinely differ here, and the
  transcript inherits that difference rather than correcting it**." Two faults. First, Console applies
  the same filter to the transcript: `ConsoleNodeRoom.tsx:603` reads
  `const visibleMessages = row === null ? [] : selectNodeRoomMessages(allMessages, row.selection);` and
  feeds it straight into `buildAgentHistory` and then `ConsoleAgentHistoryList`. Second, the cited lines
  379-400 render a different surface — a `<details>` per loop iteration whose summary is `×N <status>`
  and whose body is a list of node ids and statuses, not a tool transcript. _Fix:_ correct the claim.
  Note also that the summary vocabulary there is `×N`, while the transcript header says `Iteration N`;
  the spine does not say how the two relate on Console.
- **high** Information Architecture and Responsive & Platform disagree on whether the surfaces differ.
  IA: "**The two surfaces genuinely differ here.**" Responsive & Platform: "Two surfaces, one anatomy.
  The delta is tokens and panel width, never structure." On the evidence above, Responsive & Platform is
  right and IA is wrong. _Fix:_ resolve with B1.
- **medium** A count does not match the table it cites. Accessibility Floor: "four inherited token pairs
  fall short and are listed as `DESIGN.md` Open Questions 1–3". The contrast table holds five bold cells
  — text-tertiary on both surfaces, error on Legacy, node-prompt on both surfaces — across three
  foreground-background pairs. Neither number is four. _Fix:_ state the count that matches.

## 8. Shape fit — strong

`DESIGN.md` holds all eight canonical sections in the locked order: Brand & Style, Colors, Typography,
Layout & Spacing, Elevation & Depth, Shapes, Components, Do's and Don'ts. Open Questions follows as an
invented section and earns its place.

`EXPERIENCE.md` holds all eight required defaults: Foundation, Information Architecture, Voice and Tone,
Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows. Nothing is
dropped. Both required-when-applicable sections are present and both are triggered — Inspiration &
Anti-patterns by the two imports and the rejected density and glyph options, Responsive & Platform by
the two surfaces.

Four invented sections: Provider normalization at the edge, Occurrence grouping, Elision and badge
priority, Open Questions. Occurrence grouping earns its place — it holds the decided label vocabulary
and the reasons two alternatives were rejected. The other two are noted in §6.

### Findings

None that change what a builder makes.

## Mechanical notes

- **Frontmatter is stale in both spines.** Both carry `updated: 2026-09-09` and `status: draft` while
  the content changed on 2026-09-10. The memlog frontmatter carries `2026-09-10T00:20`. Finalize sets
  both files to `status: final` and the current date at the end, so this is expected mid-gate; noted so
  it is not forgotten.
- **`.working/` duplicates `mockups/` byte for byte.** All three HTML files have identical MD5 sums in
  both directories. The promote step copied rather than moved. Harmless, but a later edit to one copy
  will not reach the other — the states sheet has already been edited twice in `mockups/` since the copy
  was made.
- **Token check, reproducible:** 236 frontmatter paths, 89 distinct `{ref}`s, 220 occurrences, zero
  unresolved. Three defined tokens are never referenced by `{ref}` and are named in prose instead.
- **Contrast check, reproducible:** all 20 published cells match an independent OKLab-to-sRGB plus WCAG
  relative-luminance computation from the oklch declarations in `index.css` and
  `experiments/console/theme.css`. The sentence "the numbers above come from a single unverified pass"
  can be retired for arithmetic. The accessibility lens owns what the shortfalls mean.
- **No broken cross-references.** Every `mockups/` and `imports/` link resolves. Every §-anchor cited
  (§A, §C, §E, §F) exists in the states sheet. All twelve `sources:` entries across the two spines
  resolve on disk. No Mermaid in either file.
- **One quoted source phrase is not in the source.** "scoped to exactly that run" is presented as the
  HITL README's wording. The README says "panel chips switch iterations" and "panel chips switch
  passes"; a grep of the whole HITL spec directory returns no match for the quoted phrase. The claim it
  supports may still be right; the quotation marks are wrong.

## Unresolved questions

1. B1 decides whether the `Run N` occurrence header ever renders under an occurrence chip. Until it is
   settled, CAP-6's reader-visible behaviour and Flow 2 are both unbuildable as written.
2. The `⚠` interrupted badge has no colour token while its glyph has one. Deliberate, or an omission?
3. Does the occurrence header survive an active loop-iteration filter, which leaves one occurrence?
4. Which body arm does the `web` family use?
5. The states sheet was regenerated at 00:26:12, after this walk read §C. Hard case 4's chip-ellipsis
   caption needs one more look against the resolved family-name rule.

## Post-write check

`DESIGN.md` changed again at 00:27:48 and `EXPERIENCE.md` at 00:28:33, after this report's snapshot.
All six blocking findings were re-checked by exact-string search against those newer files and all six
still stand. One non-blocking site of B2 was fixed in `EXPERIENCE.md`; the two sites in `DESIGN.md`
remain. Nothing else was re-reviewed.
