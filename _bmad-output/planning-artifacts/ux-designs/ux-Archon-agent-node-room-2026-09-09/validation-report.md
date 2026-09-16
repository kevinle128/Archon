# Validation Report — Readable agent transcript (Archon)

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`
- **Reviewers:** `review-rubric.md`, `review-accessibility.md`
- **Spines at revision:** 76853497
- **Run at:** 2026-09-10T01:14+07:00

## Overall verdict

The token layer is the strongest part of this pair, and it is verifiably correct: 89 distinct `{path.to.token}` references over 236 defined paths resolved with zero misses, and an independent recomputation of all 20 published contrast ratios from the oklch declarations reproduced every cell. The weak part was the transcript's relation to the room around it. The Information Architecture section stated a surface difference in occurrence filtering that the shipped code contradicted, and the whole `Run N` occurrence header — the reader-visible payoff of CAP-6 — depended on that statement. Three more faults were stale text: a decision was resolved in one section and its earlier assumption was left standing in another, so a builder found two answers to the same question.

The accessibility lens re-measured every ratio from the CSS rather than from the spine, and it moved the picture in one direction: the shortfall was wider than the spine recorded. Console failed on tertiary text as well as Legacy, the hovered row was worse than the resting row on both surfaces, and the Console focus ring composited to 1.4:1 against a 3:1 floor. The lens also recorded what the design gets right, and that part is real — outcome never depends on colour, the primary reading path passes everywhere, and the spine published its own failing cells instead of hiding them.

**This is a post-resolution report.** Both reviewers ran, and the spines changed after each one returned. Every finding carries a disposition beside its severity. Severity is the reviewer's judgment of the snapshot they read, and it is never re-graded here. Disposition is a separate axis and records what happened next. **Of 41 findings, 39 are closed.** The two that stay open are wording items in one category, and neither changes what a builder makes. One question was reopened after the reviewers finished, against the spine's own author, and it is recorded at the end.

## Disposition key

| Disposition       | Meaning                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| **fixed**         | The spine changed. The finding no longer applies to the text.                            |
| **user decision** | The question went to the user, and the user answered it. Three questions took this path. |
| **accepted**      | The shortfall stays, and the spine records the reason.                                   |
| **superseded**    | A later correction made the finding moot.                                                |
| **open**          | The finding still applies to the spines at this report's revision.                       |

## Category verdicts

- Flow coverage — adequate
- Token completeness — strong
- Component coverage — thin
- State coverage — adequate
- Visual reference coverage — strong
- Bloat & overspecification — strong
- Inheritance discipline — thin
- Shape fit — strong

## Findings by severity

Two findings were reached by both lenses. Each is counted once, at the higher severity, and cross-referenced.

### Critical (13)

**[Rubric §1 Flow coverage]** — Flow 2 rests on the occurrence-filtering claim (EXPERIENCE.md → Key Flows, Flow 2 steps 2–3) · **fixed**
Reviewer: "Under an occurrence chip the messages request carries `occurrenceId`, so Run 1's rows are not in the payload." The fix had two steps: settle the filtering question, then re-walk Flow 2.
Disposition: both steps are done. The flow no longer clicks a run chip and then reads both runs. Step 2 leaves the chips alone, so the panel stays scoped to the node and the transcript carries both executions, and it states the trade: clicking `run 2` would narrow the transcript and take the occurrence headers with it, "which is the wrong move when the question is what changed between the two". That is what the Legacy mock draws and what CAP-6 needs to show.

**[Rubric §3 Component coverage]** — The `web` family has no body arm anywhere · **fixed**
Reviewer: "A builder opening a `WebFetch` row has no rule." The upstream contract declares one.
Disposition: fixed in all three places the reviewer named — a `Body box: web` row in Component Patterns, the visual arm in `DESIGN.md` Components ("the requested URL as the header, the page or result title beneath it, and the body rendered as markdown — the one arm whose content is prose rather than machine output"), and a collapsed row plus an expanded arm in the states sheet. The spine records why the rarest arm still earns one: "a family with a chip colour and no arm would fall through to the generic key-value list and lose the title."

**[Rubric §3 Component coverage]** — The `⚠` glyph did not reach two `DESIGN.md` sections · **fixed**
Reviewer: "Components is the section a builder implements."
Disposition: fixed at both sites. Components now reads "✓ success, ✕ error, ◐ running, ⚠ interrupted, – unknown", and the Do's row carries the same five characters.

**[Rubric §3 Component coverage]** — Two chip-label rules stand at once · **fixed**
Reviewer: the two rules count different things — the contract counts characters of the tool name, and `{spacing.chip-max}` is a CSS width of `24ch`.
Disposition: fixed. A tool name over 24 characters now chips the family, so `get_command_or_subagent_output` reads `generic`, and the cap is stated as a guard that should never fire.

**[Rubric §3 Component coverage]** — The full-output control has two homes · **fixed**
Disposition: the superseded assumption is deleted, the body bar says the control is not there, and Flow 3 names the button under the body. The reason is recorded: the control fetches more bytes, and Raw redraws the same bytes.

**[Rubric §4 State coverage + Accessibility N-1]** — Two keyboard rules stand at once · **fixed**
Accessibility lens: "There is no such native behaviour … Arrow keys do nothing to focus."
Disposition: the superseded assumption is deleted. Only the resolved answer remains, with its reason: a transcript is a list of disclosures, not a composite widget.

**[Rubric §7 Inheritance discipline]** — The occurrence-filtering claim is contradicted by the code it cites · **fixed**
Reviewer: "the absence of a client-side second pass is not the absence of filtering … This is new evidence, not a counter-argument: it names two files the recorded decision does not cite."
Disposition: fixed, and it reversed a decision the spine had already recorded. Information Architecture now separates the two filters — the server applies the occurrence filter from `occurrenceId` and `attemptId`, and the client slices only loop iterations — and confirms the quoted README wording for both rooms. The reversal was carried through to everything that rested on it: Flow 2, the occurrence-header rule, and the resolved-questions table.

**[Rubric §7 Inheritance discipline]** — "Console does not filter at all" is false · **fixed**
Reviewer: "the cited lines 379-400 render a different surface … not a tool transcript."
Disposition: the section states that both surfaces behave the same way and cites Console's own call site and its own copy of the module.

**[Accessibility B-1 + Rubric §2 low]** — The Console focus ring fails, and the spine records the wrong value for it · **fixed**
Accessibility lens: "ratio **1.36:1** … A builder who trusts the frontmatter will ship an invisible focus ring and believe it was specified."
Disposition: fixed, and both lenses are recorded because each contributed a different fact. The rubric asked for the hex, the comment and the variable name to agree. This lens supplied the measurement and the ownership: the shipped token is 1.36:1, and the passing 2px `--accent-bright` outline "exists only in the states sheet" — neither room mockup defines a focus rule at all. The spine now carries both: the shipped value is a table row, split per surface because Legacy has no `--accent-ring` at all, and `--accent-bright` for the transcript row is named as a deliberate departure rather than an inheritance. The 1.4:1 ring stays on the room chrome, which is out of scope. Neither lens chose the remedy; this one listed four options and declined ("Options A and B touch a token, which is outside my remit").

**[Accessibility B-2]** — Legacy `--error` is below 4.5:1 for the `exit n` badge (4.29:1, and 3.78:1 on hover) · **accepted**
Accessibility lens: "The failure stands whichever way the glyph is classified." On the deletion argument: "That is a product judgement, not an accessibility one. It is the user's to make."
Disposition: accepted with a recorded reason. The contrast table carries the shortfall in bold: "error glyph and `exit n` badge on surface — **4.3:1** Legacy, 5.9:1 Console". The second half of the finding is fixed — the false threshold argument is gone, and no section now claims the bold `✕` passes a 3:1 graphical-object floor. One number did not travel: the 3.78:1 hover figure is in the review file only, and the spine's table carries the resting value.

**[Accessibility B-3]** — The folded todo `✓` at 55% opacity fails on both surfaces (2.70:1 Legacy, 3.58:1 Console) · **fixed**
Accessibility lens: "the glyph is the outcome carrier for the row … The glyph is the only status the reader gets."
Disposition: the opacity is dropped. The user's own glyph choice was full-strength colour reinforcement, so the dimming was an unratified assumption. The folded row keeps its subordination by dropping its headline from primary to secondary. Nothing was made quieter to restore the difference; the content was made louder.

**[Accessibility B-4]** — The Raw button has no perceivable boundary and no readable label on Legacy · **user decision**
Accessibility lens: "border 1.29:1 … label 2.51:1 … 1.4.11 permits a weak boundary when the label alone identifies the control. That exception does not apply here, because the label also fails."
Disposition: both halves are closed, by two different routes. The label is fixed by user decision — every transcript fact moved to `--text-secondary`, so Raw's label measures 5.8:1 Legacy and 8.4:1 Console. The border is accepted with a recorded reason, and the spine answers the lens on its own ground: the border stays at 1.3:1 and 1.2:1 "because the criterion asks for the information _required to identify_ a control, and the word `Raw` at 5.8:1 / 8.4:1 does that". That is the 1.4.11 exception the lens ruled out while the label was failing, and it applies now that the label passes.

**[Accessibility B-5]** — Legacy `--text-tertiary` carries the unknown outcome at 2.51:1 · **user decision**
Accessibility lens: "This is not secondary information. It is one of the five outcomes the feature exists to report."
Disposition: fixed by user decision, and wider than the finding asked. Every transcript fact moved from `--text-tertiary` to `--text-secondary` on both surfaces. `--text-secondary` clears the floor everywhere (5.8:1 / 8.4:1) and is an existing token, so the no-new-token constraint holds. `--text-tertiary` now has exactly one use: the chevron, which carries no fact and is hidden from assistive technology.

### High (4)

**[Rubric §3 Component coverage]** — The subtask card is collapsible with no visual disclosure spec · **fixed**
Reviewer: "no toggle affordance and no expanded appearance. The upstream contract requires it: `SPEC.md` CAP-4."
Disposition: the card is itself a `<details>`, so it carries the row's chevron and the same 120ms rotation; closed it is one line, and open it adds the full prompt preformatted in an inset box within the card. The spine states why: "Nesting a disclosure inside a disclosure is the reason the card reuses the row's chevron rather than inventing a second affordance."

**[Rubric §4 State coverage]** — An open row whose result has not arrived has no rule · **fixed**
Reviewer: "Nothing states what the body holds when there is no output — an empty terminal box, a partial one, or the body bar alone."
Disposition: a new row covers it. The body draws the call — whatever the family's arm takes from the input — and says `awaiting output` where the output would go. The rule is stated as a principle: "a tool that has not answered yet must not look like a tool that answered with nothing." When the result pairs, the output replaces that line in place, the glyph flips, and the row stays open because the reader opened it.

**[Rubric §4 State coverage]** — The iteration filter and the occurrence header collide · **fixed**
Reviewer: "Both rules are deterministic; the intent is not recorded."
Disposition: the header rule now names the condition on the messages actually displayed, and states both consequences outright — it does not appear under an occurrence chip, which scopes to one, nor under a loop-iteration chip. The intent is recorded rather than left to be derived from two rules.

**[Rubric §7 Inheritance discipline]** — Two sections disagree on whether the surfaces differ · **fixed**
Reviewer judged Responsive & Platform right and Information Architecture wrong.
Disposition: fixed with the rewrite. The claim of a genuine difference is gone, and the two sections agree.

### Medium (11)

**[Rubric §1 Flow coverage]** — CAP-4 is claimed but never walked · **fixed** — Flow 1 now opens the task row, so CAP-4 is demonstrated and not only claimed.

**[Rubric §2 Token completeness]** — The `interrupted` badge has no colour token · **superseded** — the text-tier decision gave every badge one colour, `text-secondary`, on both surfaces, so a per-state badge pair is no longer the open question it was. The glyph keeps its own warning pair.

**[Rubric §3 Component coverage]** — The Raw button has no hover state and no focus appearance · **fixed** — the Raw toggle block now states "Hover and focus raise it to `border-bright` and `text-primary`, which is where the affordance is confirmed." The states reuse the tokens the open state already holds, so the frontmatter needs no new key.

**[Rubric §4 State coverage]** — The transcript has no load-error state · **fixed**, and the answer is the reviewer's second option: the transcript adds no error surface of its own and keeps the room's error path. A failed fetch leaves the room's placeholder in place and never renders an empty transcript, "because 'no rows' and 'could not read the rows' must not look alike".

**[Rubric §4 State coverage]** — One assumption has no matching Open Question (Raw placement) · **superseded** — the `EXPERIENCE.md` Open Questions list now reads "None", and Raw's placement is stated as a rule at Component Patterns.

**[Rubric §7 Inheritance discipline]** — A count does not match the table it cites ("four inherited token pairs") · **fixed** — the sentence no longer states a count.

**[Accessibility N-2]** — Screen-reader semantics are unspecified, and two defaults read badly · **fixed** — the chevron is hidden from assistive technology, the glyph carries a required accessible name, and the elision reconciliation kept the CSS two-span rule authoritative, because a produced string with characters cut out "would destroy the path for every reader at once". `aria-expanded` comes free from the native element, with a build-time verification step recorded.

**[Accessibility N-3]** — Family is conveyed by colour alone (WCAG 1.4.1) · **user decision** — the family now travels on three channels: the chip's accessible name, the chip's `title`, and the first word of the body bar. The body bar always works, so that word is a requirement and is never dropped under width pressure. A family prefix inside the chip was rejected because it costs row width on the one line that must never wrap.

**[Accessibility N-5]** — Streaming: no scroll anchoring and no focus-stability rule · **fixed** for both documented halves — scroll anchoring and focus-on-append are specified from Console's shipped behaviour. One further bullet adopted at the time was later **withdrawn by its own author**: the requirement for `scroll-margin-top` against a sticky header rested on a layout the room does not have. `LegacyNodeRoom` renders header and body as siblings and the scroller sits inside the body, so the header sticks to a container the transcript does not scroll within and cannot cover a focused row. The spine records SC 2.4.11 as satisfied by the layout and keeps the rule as a forward guard. The announcement rule was corrected at the same time to one polite `role="status"` region, because the earlier "announce nothing" plan rested on a panel badge that has no role and no live region.

**[Accessibility N-7]** — Target size is borderline and must be measured in a browser · **user decision** — the Raw toggle grows to a 24px minimum height through padding, so its painted box is unchanged. The 22px tool row keeps its 2px shortfall against SC 2.5.8 as a recorded decision: row density is the feature the transcript exists to deliver, and the surface is reached with a pointer. Revisit if the surface is ever targeted at touch.

**[Accessibility N-9]** — Occurrence headers are not headings · **fixed** in the spine, which is what governs: the header is "not interactive, but it is a section label, so it carries a heading role rather than a bare `<div>`; a screen-reader reader can then jump between executions the way a sighted reader jumps between rules." The Legacy mock still draws a `<div>`; the spine wins on conflict.

### Low (13)

**[Rubric §1]** — The capability-coverage line was false for Flow 3 · **fixed** — the line now scopes CAP-6 to Flows 1 and 2 and gives the reason.

**[Rubric §1]** — The protagonists carry no context · **fixed** — the invented persona is replaced by a role, because the project context declares one user and inventing a second would put a fictional person in a contract.

**[Rubric §2]** — Three defined tokens are never referenced by `{ref}` · **accepted** — raised as a note for a mechanical extractor, not as a defect.

**[Rubric §5]** — §D is never cited by anchor · **fixed** — the Tool body row in Component Patterns now cites it: "Every arm is drawn once per family in `mockups/key-transcript-states.html` §D."

**[Rubric §5]** — The states sheet §E mixes the two vocabularies · **accepted** — the spine wins on conflict, so this is a mock artefact. Reviewer: "Fix: none needed."

**[Rubric §5]** — The two room mocks are older than the spines · **accepted**, as the reviewer filed it ("noted for the next mock pass") — the mocks were revisited afterwards and a full token diff now shows zero drift, so the values agree even where the markup still trails a later spine rule.

**[Rubric §6]** — The elision and badge rule is stated three times · **open**, and reduced. The Component Patterns row now points to the section by name; the Responsive & Platform pressure order and the Narrow panel state row still restate the rule. Next: point those two at the section as well.

**[Rubric §6]** — "Provider normalization at the edge" partly restates its source · **open** — the todo/task normalizer bullet and the `path` reversal bullet both still carry the mechanism. Next: keep the reader-visible consequence and cite the mechanism.

**[Rubric §6]** — Pixel literals appear in Components prose · **accepted** as one-offs.

**[Rubric §6]** — Prose names surface tokens without the surface suffix · **accepted** — the component objects carry both variants, so the ambiguity is recoverable.

**[Accessibility N-4]** — Chip borders are 1.73:1 to 2.28:1 · **accepted** with a recorded reason — the chip is not interactive and the border is not the only means of identifying it, so 1.4.11 does not apply. The borders stay as non-essential decoration.

**[Accessibility N-6]** — Reduced motion is assumed, not specified · **fixed** — the assumption is now a rule. The rotation is the transcript's only animation, so honouring the preference costs one media query.

**[Accessibility N-8]** — The Console mockup's `--error` does not match `theme.css` · **fixed**, and checked wider than the one value. The mockup now declares the `theme.css` value, and a full token diff of all three mockups against `index.css` and `theme.css` shows zero drift across 19 shared tokens and 14 node hues. The spine's own Console hexes were already correct.

## Found after the reviewers

Four defects surfaced after both lenses returned, and re-checking found them rather than a reviewer. They sit outside the severity totals above. The fourth is the only question this pair still carries.

**high · fixed** — Flow 1 claimed each subtask card carries its own outcome. `TaskSubtask` is `{name, agent, prompt}` at `tool-presentation-contract.md:49` and has no outcome field, so the presenter has nothing to render. The flow now says the cards show what was dispatched, and the row's own glyph is the only status.

**medium · fixed** — Two contrast cells were written from estimate, not arithmetic. `surface-hover` was published as 5.4:1 and 7.7:1; recomputed through oklch to sRGB to relative luminance it is **5.1:1 and 7.5:1**. `surface-inset` was right at 6.3:1 and 8.9:1. The converter was first calibrated against the ten cells the rubric had already verified and reproduced all ten, so the new numbers are trustworthy. The warning glyph was measured at the same time (8.3:1 and 10.1:1) and added. The header no longer calls the cells an approximation, because they are computed.

**medium · fixed** — A dangling token reference was left by an earlier edit. One `{path.to.token}` reference survived the edit that removed the token it named — the exact failure the token-completeness pass exists to catch, introduced after that pass ran. A re-check at this report's revision resolves 77 distinct references against 244 defined paths with zero misses.

**medium · open** — The `--node-prompt` chip pair was marked resolved when nothing resolved it. The accessibility lens measured this pair and published both values as failures in its own tables — **3.74:1 Legacy and 3.89:1 Console** against `surface-elevated`, where 11px chip text needs 4.5:1 — and noted that `DESIGN.md` gave one rounded number for two surfaces. It never became a numbered finding. What was found afterwards is worse than the measurement: the question had been folded into a renumbering and marked resolved while nothing had resolved it. It is now reopened deliberately, by the spine's own author against their own record.

The question is narrow. It is the only family hue that fails: `--node-command` clears at 4.8:1 / 4.9:1, `--node-approval` at 6.5:1 / 6.8:1, `--node-bash` at 7.6:1 / 7.9:1, and `generic` sits in `--text-secondary` at 5.8:1 / 8.4:1 — so this is two chips, `search` and `glob`, not the palette. The text-tier decision does not reach it, because a chip's colour **is** its family and the family-hue system is a user decision; recolouring these two to grey would delete the meaning the chip exists to carry. Two ways out, both inside the no-new-token rule:

- **Brighten the two chips' text** with `color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))`, keeping the border in the pure family hue so the violet identity survives. Clears 4.5:1 and changes only these two chips.
- **Accept, and record it** — the chip is a redundant label, since the tool name sits inside it and the family is also in the body bar, the accessible name and the tooltip, so no fact is lost by a reader who cannot resolve the violet.

`DESIGN.md` carries `status: final` with a trailing comment naming this one question, so the status does not overstate the state.

## Mechanical notes

- **The spines moved during the review and after it.** Findings are re-checked against the committed state at revision 76853497. The rubric's own post-write check found all six of its blocking findings still standing; all six are closed now.
- **Token check, twice.** The rubric counted 236 defined paths and 89 distinct references, zero unresolved. The re-check at report time counts 244 paths and 77 distinct references, zero unresolved. The drift is expected: the text-tier decision replaced many bare token references with one rule, and later edits added paths.
- **Contrast check, reproducible.** All 20 originally published cells match an independent OKLab-to-sRGB and WCAG relative-luminance computation. Cells added later were recomputed after the converter was calibrated against those 20.
- **Two findings were reached by both lenses.** The focus ring (rubric §2 low, accessibility B-1) and the arrow keys (rubric B4, accessibility N-1). Each is counted once, at the higher severity.
- **One finding was withdrawn by its own author** after it had been adopted — the sticky-header scroll-margin requirement in N-5. The spine backed the fix out rather than keeping a rule that rested on a layout the room does not have, and kept it as a forward guard. A withdrawal is not a downgrade: it is the reviewer correcting the reviewer.
- **Locations are quoted as each reviewer cited them.** Line numbers have drifted since; section names still resolve, and every finding was re-checked by section rather than by line.
- **Frontmatter is now final.** Both spines carry `status: final`, and `DESIGN.md` adds a trailing comment naming its one open question.
- **`.working/` duplicates `mockups/`.** The promote step copied rather than moved, so a later edit to one copy does not reach the other.
- **No broken cross-references.** Every `mockups/` and `imports/` link resolves, every cited §-anchor exists, and all twelve `sources:` entries resolve on disk.

## Reviewer files

- `review-rubric.md`
- `review-accessibility.md`
