---
review: reconcile-inputs-against-spine
target: ../ARCHITECTURE-SPINE.md
date: 2026-09-12
method: walk each input; report load-bearing content that did not land in the spine's AD structure and that no companion covers
---

# Reconcile — inputs against ARCHITECTURE-SPINE.md

## Verdict

The spine holds on every decision it makes. What it drops is a class, not a scatter: **rules that shape what the CORE returns, when those rules were written in a UX or contract document rather than phrased as a decision.** The AD structure asks "what did we decide" and those rules never presented themselves as decisions — they arrived as a behaviour row, a tone row, an accessibility clause. Eleven of them did not land. One (AD-6) is a contradiction rather than an omission and will stall a builder outright.

Two things the spine says that no input supports are included as findings, because a false positive claim misdirects a builder as surely as a missing one.

## The two explicit asks, answered first

**(a) Does EXPERIENCE.md's Accessibility Floor constrain the CORE, or is it entirely a shell concern?**

It constrains the core, in three places, and the spine is silent on all three.

1. `:233` (Elision and badge priority, carrying the a11y rationale) — elision is **CSS on a two-span headline**, so "the full path stays in the DOM, which is what keeps it readable by assistive technology and selectable for copy. A produced string with characters cut out would destroy the path for every reader at once." That is a rule about what `toolPresentation()` may put in `headline`.
2. `:172` — "The status glyph carries an accessible name (`succeeded`, `failed`, `running`, `interrupted`, `unknown`) in visually hidden text. **This is a requirement, not a preference.**" Neither the glyph character nor its name exists anywhere in the codebase today, and neither is a field of `ToolPresentation`.
3. `:173` — "The resolved family is available without colour, on three channels": the chip's accessible name (`file · read_file`), the chip's `title`, and the first word of the body bar. Two of those three are composed strings that live in no contract type.

The rest of the Floor (native `<details>`, `Tab` contract, focus ring, reduced motion, scroll anchoring, target size) is shell, and the companion covers it.

**(b) Is any memlog decision missing from the spine, or stated differently?**

Four, plus one deliverable.

| memlog | Logged as                                                                                                                                                                       | In the spine                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `#10`  | AD-4 bans `@/lib/api` **FUNCTIONS**; "type-only `api.generated.d.ts` is allowed"                                                                                                | The carve-out is dropped from the Inherited AD-4 row — and AD-5 depends on it |
| `#18`  | `diff@8.0.3` is the resolved lockfile entry, transitive only                                                                                                                    | Stack table pins **9.0.0**; no logged decision crosses that major             |
| `#22`  | "**USER DECISION** on the CAP-5 diff gap … Options offered were this, a hand-written LCS, and a side-by-side view"                                                              | AD-4 carries the rule, not the provenance                                     |
| `#27`  | "**USER DECISION** on presenter failure containment … Options offered were this, the same plus a visible degradation marker, and fail-fast behind a transcript-scoped boundary" | AD-3 carries the rule, not the provenance                                     |
| `#14`  | "Deliverables chosen by the user: the spine **plus an interactive HTML+SVG walkthrough**"                                                                                       | The run directory holds the spine and this review only                        |

---

## HIGH

### H1 — AD-6 pins a return type that cannot carry the folded todo state

**Input:** `tool-presentation-contract.md:218` ("`buildAgentHistory()` gains the presentation on each tool item **and the folded todo state for the node**"); `EXPERIENCE.md:31` (same, verbatim); the spine's own Capability → Architecture Map ("CAP-3 … folded in `buildAgentHistory()`").

**Spine:** AD-6's rule — "`buildAgentHistory()` **still returns `AgentHistoryItem[]`**, gaining `presentation` on each tool item and carrying `metadata.execution` through."

**Why it changes the build:** `TodoPhase[]` is node-level, not per-item, and the contract explicitly forbids a `todo` body arm (`:58`). A flat `AgentHistoryItem[]` has nowhere for it to ride. The builder must either change the return type — breaking the three call sites AD-6 exists to protect — or move the fold somewhere the spine has not named. The spine's own capability map and its AD-6 rule disagree with each other.

It compounds: the folded-todo row (`EXPERIENCE.md:106`) needs per-item `headline: 'todo updated'`, badge `op: <op>`, and the knowledge that this is **not** the last todo call in the node. That is node-level knowledge inside per-item presentation, which a pure `toolPresentation({name, input, output})` cannot supply. Something post-processes the array with a node-wide view. Nothing in the spine says what, or where it lives.

**Lands in:** AD-6.

### H2 — The status glyph and its accessible name are written twice, bound by nothing

**Input:** `SPEC.md:65` ("Status must be decodable **without colour** — a glyph character carries it"); `tool-presentation-contract.md:156-158`; `EXPERIENCE.md:91, 172`; `DESIGN.md:428`; `test-plan.md:67` ("status is rendered as a glyph character, not colour alone. This is the accessibility guarantee and it is easy to regress in a restyle, so it gets its own assertion").

**Spine:** AD-1 enumerates exactly what a shell consumes — "`ToolPresentation.label`, `headline`, `headlineKind`, `badges`, and `body` are consumed as given." No glyph. No status name. `ToolPresentation` has no field for either.

**Why it changes the build:** `AgentHistoryItem.outcome` is a five-value union (`agent-history.ts:36`, verified) and no character map or hidden name exists anywhere in the tree today. Under the spine as written, each shell invents five characters and five visually hidden names independently. A divergence in the hidden name is invisible to sighted testing and to every screenshot review — and `EXPERIENCE.md:172` states why the name is load-bearing: "`◐` is announced by some screen readers as a description of the shape … and `–` is usually not spoken at all … so without the name, the unknown state announces as nothing." This is precisely a decision about _what a row means_, which AD-1's own rule assigns to `lib/`, yet AD-1's field list excludes it.

Same defect, same list: **`family` is omitted too**, although `EXPERIENCE.md:173` makes it a required text channel in three places and `DESIGN.md` makes it the chip hue key.

**Lands in:** AD-1's consumed-fields enumeration.

### H3 — Nothing says the core must not pre-elide the headline

**Input:** `EXPERIENCE.md:233` (elision is CSS on two spans; the full string stays in the DOM for AT and copy); `DESIGN.md:393` ("A path headline is two spans: a head that may shrink (`flex: 0 1 auto`) and a tail that may not"); `SPEC.md:69`.

**Spine:** `headlineKind` is "consumed as given" (AD-1). Nothing states that `headline` itself must be the complete string.

**Why it changes the build:** the core **already truncates**, twice — Tier 4 cuts values to 80 characters and Tier 3 emits first-line-plus-`…`. A builder therefore has in-module precedent for producing a shortened string, and `headlineKind: 'path'` reads naturally as an instruction to middle-elide at the point of production. Doing so destroys the path for assistive technology and for copy, which is the exact outcome `EXPERIENCE.md:233` was written to forbid. Separately, DESIGN requires a head/tail split and no document says whether the core supplies the split point (the filename boundary — arguably "what the row means") or the shell derives it. Two shells deriving it independently is the fork AD-1 exists to prevent.

**Lands in:** AD-1 or the Data & formats convention row.

---

## MEDIUM

### M1 — `label`: normalized or verbatim? Three inputs, two answers

`tool-presentation-contract.md:31` and `:160` say the chip carries "the **normalised** tool name". Tier 1 defines normalization as case-folded with `_` and `-` stripped — under which `read_file` becomes `readfile`. But `EXPERIENCE.md:79` bans "prettifying, title-casing, or translating tool names" and gives `read_file`, `Edit`, `Grep`, `eval` as the literal strings to show, and `DESIGN.md:377` repeats it: "Chip text is the tool name as the provider sent it." AD-1 says `label` is consumed as given without saying what is given. The spine is the only document that can pin a core output; two builders will produce two chips.

### M2 — Inherited AD-4 drops the type-only `api.generated` carve-out that AD-5 depends on

The spine's Inherited AD-4 row lists `@/lib/api` among the prohibitions with no exception. `memlog:#10` logged the qualifier ("`@/lib/api` **FUNCTIONS**; type-only `api.generated.d.ts` is allowed"), and the lint rule states it in its own comment (verified at `packages/web/eslint.config.mjs`): _"Block every named import from `@/lib/api` — only generated types from `@/lib/api.generated` are allowed (different module path, not matched by this glob)."_ AD-5's whole mechanism is re-aliasing `GitDiffHunk` / `GitDiffChange` from `api.generated`. As the spine reads, AD-5 appears to violate the inherited AD it sits beneath. AD-2 asserts the boundary is the lint patterns and nothing more — which is right — but the reader has to reconstruct the carve-out from that rather than being told it.

### M3 — `diff` pinned at 9.0.0 against a memlog that logged 8.0.3

`memlog:#18` recorded `diff@8.0.3` as what sits in the lockfile, transitively, from astro and pi-coding-agent. The Stack table pins **9.0.0** marked "verified 2026-09-12", and no memlog entry records crossing that major. I can confirm the lockfile state (single resolved `diff@8.0.3`; astro and shadcn want `^8`, pi pins `8.0.4`) but not jsdiff's current release from here. Either way: declaring `9.0.0` in `@archon/web` adds a **second resolved major** beside the existing 8.0.3, which AD-8's "the only operational delta is bundle size: one dependency, `diff`" does not account for. State the reason for the major, or align with 8.x.

### M4 — AD-3 and AD-4 lose their "user decision" provenance

`memlog:#22` and `#27` log both as **USER DECISION**, each with the rejected options named (hand-written LCS / side-by-side view; degradation marker / fail-fast behind a per-surface boundary). The spine states both as rules with no provenance. AD-3 in particular is "a deliberate, scoped departure from the repository's fail-fast default" — exactly the shape of decision a later audit reverses on principle. An unmarked user decision is an unprotected one.

### M5 — The body bar and the composed accessible names are placed nowhere

`EXPERIENCE.md:236` promotes a rule from coincidence to contract: "**Any badge dropped under pressure must still appear in the body bar** … it is what turns 'the duration badge drops' from information loss into one disclosure away." `:96` fixes the body bar's opening word as the resolved family and calls it "load-bearing, not decoration". `:92` adds the say-it-once rule (when the tool name already _is_ the family word — `glob`, `todo`, `task`, Codex's `shell` — the word appears once, not twice).

None of this is in `ToolPresentation`: not the body-bar fact list, not the `family · label` accessible name, not the say-it-once collapse. So both shells compose them, independently, from `family` + `badges` + per-family knowledge. That is a logic fork in the exact place AD-1 forbids one. This is partly a gap in the contract — but the spine is the document that allocates code to modules, so placement is its call.

### M6 — The module is named `todo-fold.ts`; every other document names `todo-state.ts`

`todo-fold-contract.md:10` specifies `packages/web/src/lib/todo-state.ts` exporting `projectTodoState()`. `test-plan.md:40` names the test file `todo-state.test.ts`. The spine's Structural Seed and Capability map both say `todo-fold.ts`, and its Naming convention ("Tests sit beside them as `<module>.test.ts`") makes that `todo-fold.test.ts`. A builder following the spine creates a module and a test file that the contract and the test plan never mention. `tool-presentation.ts` and `task-normalize.ts` both match; this one does not.

### M7 — "The shells add no logic of their own" is not true, and the duplicated logic is unbound

The Design Paradigm says the shells "own JSX, scroll, and focus, and **add no logic of their own**." EXPERIENCE.md requires each shell to carry, identically:

- default open state driven by outcome (`:90` — collapsed on `succeeded`, open on `failed`);
- **manual open/close outranking every automatic rule** (`:158`), persisting across live re-renders and never reset by an arriving row — a controlled/uncontrolled hybrid, since a naive `open={outcome === 'failed'}` discards the reader's action on the next render;
- one polite `role="status"` region with a what-to-announce policy (`:181` — node transitions and failures only, never per row);
- stick-to-bottom only when already at the bottom, and no focus move on append (`:175`);
- anchoring the checklist at the last todo call and folding every earlier one (`:106`).

That is five pieces of duplicated behavioural logic. The finding is not that the spine omits EXPERIENCE.md's content — it is that the spine asserts the shells carry none, so nothing flags this as the second place divergence can enter, and no invariant binds the two copies to agree.

---

## LOW

- **L1 — `SPEC.md:62` says wire types arrive "through `lib/api.ts`"; the spine's convention says "`api.generated.d.ts` **only**".** The spine's version is the correct one under the Console lint rule, but it silently supersedes a SPEC constraint for _every_ new core module, while AD-5 scopes the reasoning to the moved adapter alone. One clause noting the departure.
- **L2 — the Codex prefix strip exists only in a UX document.** `EXPERIENCE.md:93` requires Codex names to "lose the fixed `/bin/zsh -lc '` or `/bin/bash -lc '` prefix and closing quote" before the first-line rule applies. `tool-presentation-contract.md:136` (Tier 3) has the first-line rule and no prefix strip; `test-plan.md:24` tests only the newline case. A companion is specifying headline computation the source contract lacks, and the spine — which does say provider differences normalize in `lib/` — never marks EXPERIENCE's Headline row as binding input to `tool-presentation.ts`.
- **L3 — `lib/` is not React-free.** The Design Paradigm describes the directory as "pure TypeScript … no React". `use-container-split-mode.ts` (and its `.test.tsx`) already live there, as `memlog:#13` recorded. Harmless as an aspiration, misleading as a description — state it as a rule binding the new modules.
- **L4 — the JSON.stringify ban is one clause short of explicit.** `SPEC.md:64`: "No raw `JSON.stringify` as a default presentation anywhere in the transcript … **re-introducing it in a fallback path fails the spec**." AD-3 creates a new fallback path and points at "the `generic` arm, which the contract already defines as the escape hatch" — which does cover it by reference. Reinforcement, not a gap; noted because AD-3's path is the precise place `SPEC.md:64` was aimed at.
- **L5 — the interactive HTML+SVG walkthrough is absent.** `memlog:#14` records it as a user-chosen deliverable alongside the spine. Outside the inputs→spine reconciliation, flagged because it is a logged decision with nothing in the run directory behind it.

---

## Checked and clean

Not findings; recorded so the next reviewer does not re-walk them.

- Every SPEC Constraint except those above: no-schema/no-migration (scope + AD-8), Console/`@/components` (AD-1, AD-2), duck-typing over alias sets with whole-token matching (Data & formats), provider normalization at the edge with "a shared key name is not evidence of a shared shape" (Provider differences), strict TS / `bun run validate` (Gate), no plan refs in comments or test names (Comments row).
- Every SPEC Non-goal that has an architectural hook. RunStream `ToolCallItem.tsx`, the backend `tool-formatter.ts`, and the run-level "Files changed" panel have none, and a spine is not obliged to restate a non-goal it cannot bind.
- `occurrence_id` as the only grouping key and `attempt_id` never a key or a label — AD-6 carries it; the `Run N` / `Iteration N` wording is companion-owned.
- The whole CAP-5 chain: the gap, the jsdiff decision, the `StructuredPatchHunk` correction, the ~20-line mapper, the `undefined` degradation path, the adapter move, the `requiredLine()` throw containment. `memlog:#18-26` are all present and accurate in AD-4 and AD-5 (only the version and the provenance are off — M3, M4).
- The AD-4 staleness correction, its lint evidence, and the decision to offer it upstream rather than override locally (`memlog:#12, #15, #16, #17`) — Inherited Invariants plus Deferred.
- The CAP-id collision guard (`memlog:#11`) — present verbatim.
- Eager attach with no memoization and the revisit condition (`memlog:#21`) — AD-7, including the three call sites.
- DESIGN.md's one open question (`--node-prompt` at 3.7:1 / 3.9:1) is visual and companion-owned; it does not reach the core.

## Unresolved questions

1. H1 and M5 both point at a layer the spine has not named: something between `toolPresentation()` (per-item, pure) and the shells that holds node-wide knowledge — the todo fold, the last-todo anchor, the body-bar composition, the occurrence groups. `occurrence-groups.ts` is the only member of it the spine names. Is that one module or several?
2. M3 needs the jsdiff release list, which I could not reach from here. Someone should confirm whether 9.0.0 exists and what it buys over the 8.0.3 already resolved.
3. M1 needs an owner's call, not a reconciliation: `read_file` or `readfile` on the chip. The contract says one, both UX spines say the other.
