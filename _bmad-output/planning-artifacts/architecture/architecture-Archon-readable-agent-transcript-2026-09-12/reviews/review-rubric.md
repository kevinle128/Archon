# Rubric review — ARCHITECTURE-SPINE.md (Readable Agent Transcript, Track A)

Reviewed: `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`
Date: 2026-09-12. Adversarial architecture review against the good-spine checklist.
Judged as a spine — terseness is correct, absent rationale is correct, it is not asked to be a design doc.

**Verdict: strong spine, not yet shippable as an invariant set.** Every code claim it makes is true, its
inherited-invariant handling is honest, and its operational envelope is decided rather than assumed. Four
divergence points the level below will hit on day one are not fixed: where the folded todo state lives in
the return contract, who calls the differ and when, what an occurrence group actually carries, and what
happens to the `context` field one shell still renders. One AD contradicts another, and AD-3's redaction
rule logs the payload on 21% of real rows.

---

## 1. Does it fix the real divergence points, and miss none?

Mostly. It fixes the ones a reviewer expects — module placement (AD-2), failure containment (AD-3),
dependency ownership (AD-4), type source for the move (AD-5), return-type stability (AD-6), memoization
(AD-7), rollback (AD-8). The misses below are all places where two independently-built units produce
different transcripts from the same rows.

### F1 — CAP-3's folded todo state has no home in the return contract (high)

AD-6's Rule is exact: `buildAgentHistory()` **still returns `AgentHistoryItem[]`**, gaining `presentation`
per tool item and carrying `metadata.execution` through. The Capability map then says CAP-3 is
"`todo-fold.ts`, folded in `buildAgentHistory()`", and the driving contract is explicit that
`buildAgentHistory()` gains "the presentation on each tool item **and the folded todo state for the node**"
(`tool-presentation-contract.md:218`).

A node-level `TodoPhase[]` cannot live in a flat `AgentHistoryItem[]` without one of three choices the
spine never makes:

1. hang it off the last `todo` item as a new field,
2. add a new item kind for the checklist,
3. change the return to `{ items, todo }` — which AD-6 forbids by name.

Two builders will pick differently, and the one who picks (3) breaks the three call sites AD-6 exists to
protect. Worse, CAP-3 also requires a **per-node anchor** decision — "renders once, anchored at the last
todo call; earlier todo calls collapse to a one-line row" (`todo-fold-contract.md:83`, SPEC CAP-3). Deciding
which todo row is the anchor is a decision about what a row means, so AD-1 sends it to `lib/`; AD-6's stated
return has no slot for it, so both shells will compute it. That is precisely AD-6's own "Prevents".

The grouping case got a named separate function. The todo case needs the same treatment and did not get it.

### F2 — AD-4 fixes the differ but not its call site, and AD-7's cost argument never covered it (high)

`ToolPresentation.body`'s diff arm is `{ kind: 'diff'; path; before; after }` — raw strings
(`tool-presentation-contract.md:41`). So `structuredPatch()` is **not** called by the presenter. AD-4 says a
mapper in `lib/` walks the hunk lines, and AD-5 puts the adapter behind it, but nothing in the spine says
who calls that chain or when. The two live answers pull opposite ways:

- **Eagerly, inside the presenter.** Then AD-7's justification is wrong for this path. AD-7 prices the
  decision at "the resolver costs microseconds" at forty rows — a measurement of the resolver, not of a
  Myers line diff over two file versions, re-run on every render at all three call sites. (Verified: none
  of the three is memoized — each is a plain expression in the component body, `ConsoleNodeRoom.tsx:604-611`,
  `ConsoleExecutionHistory.tsx:204-208`, `NodeTranscriptPane.tsx:233-240`. AD-7's premise holds; it is the
  scope of its cost claim that does not.)
- **Lazily, when the row expands.** That is a behavioural decision taken in the shell, which AD-1 forbids,
  and each shell will decide it separately.

Either answer is defensible; leaving it open is the failure. This is a one-clause fix.

### F2b — the stated degradation path is dead code unless a bound is set, and no bound is fixed (high, same AD)

AD-4: "`structuredPatch` returns `undefined` past its timeout or edit-length bound — that path degrades to
path-plus-preview." Verified against `diff@9.0.0`'s published declarations
(`libcjs/patch/create.d.ts`): `undefined` appears in the return type **only** on the abortable overloads,
which require a `timeout` or `maxEditLength` option (`AbortableDiffOptions = TimeoutOption |
MaxEditLengthOption`, `libcjs/types.d.ts:43`). The plain call

```ts
structuredPatch(a, b, oldStr, newStr, undefined, undefined, { context }); // → StructuredPatch, never undefined
```

returns a non-optional `StructuredPatch` and runs the diff to completion, synchronously, on the render
thread. So a builder who omits the bound gets: no `undefined` branch (TypeScript will flag the fallback as
unreachable) and an unbounded diff on a large edit — the exact UI-freeze hazard the sentence implies is
handled. A builder who adds the bound picks an arbitrary number. The spine fixes neither the option nor its
value. Pin both, or the degradation path is prose.

### F3 — the occurrence group's contents are undecided, and the row set feeding it is already filtered (high)

Two problems in one AD.

**(a) The group carries no stated label, so both shells will derive it.** AD-6 fixes the key
(`occurrence_id`) and one prohibition (`attempt_id` is never a key or a label) and stops there — "a separate
pure function in `lib/` takes that array and returns groups" leaves the group's shape open. The adopted UX
spine fixes real label vocabulary with real drivers: `Run N` from `retry_epoch` with `· retry` / `· failed`
suffixes, `Iteration N` from `loop_ancestry`
(`ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`, Occurrence grouping). Deriving `Run N` vs `Iteration N` from
`retry_epoch` + `loop_ancestry` is core reasoning under AD-1. If the group does not carry it, each shell
writes it — AD-6's stated "Prevents" ("each shell writing the occurrence-versus-attempt reasoning for
itself"), realised.

**(b) On the occurrence-entry path the header can never fire, and the spine does not say whether that is
intended.** All three call sites feed `buildAgentHistory()` the output of
`selectNodeRoomMessages(allMessages, row.selection)`, immediately before the call
(`ConsoleNodeRoom.tsx:603→607`, `ConsoleExecutionHistory.tsx:203→204`,
`NodeTranscriptPane.tsx:232→236`). That module states, for occurrence-scoped selections, "server already
filtered by `occurrence_id`/`attempt_id`"
(`packages/web/src/experiments/console/components/inspect/select-node-room-messages.ts:12-13`), and the
loader's own type carries `{ kind: 'occurrence'; occurrenceId; attemptId? }`
(`packages/web/src/lib/node-message-pages.ts`). The inherited HITL spine ratified the matching Logs
convention: "Unmerged node-**run** rows (iteration = its own row)".

So whenever the reader entered through an occurrence-scoped log row, the room holds exactly one occurrence
and CAP-6 renders nothing — correct by CAP-6's letter, and quite possibly the intended reading, but the
spine never says so. A builder who wants CAP-6 visible will widen the fetch to `kind: 'node'`; a builder who
does not will ship a grouper that never groups. Both can cite AD-6. One sentence naming which row set the
grouper consumes closes it.

### F3c — removing `toolContext()` empties a field one shell renders today (medium)

The Structural Seed says `agent-history.ts` "gains `presentation`; `TOOL_CONTEXT_KEYS` + `toolContext()`
removed", and the contract agrees they are "superseded by the resolver and go away"
(`tool-presentation-contract.md:219`). Those two produce `context: { label, value }[]` on the tool item
(`agent-history.ts:33,50`) — and Legacy renders it: `{item.context.map(entry => (` at
`packages/web/src/components/workflows/NodeRoom.tsx:246`. Console does not read it at all.

So deleting the producer either empties or deletes a field that exactly one shell currently renders, which
is a change to the item contract at the three call sites — the thing AD-6 exists to control. AD-6 enumerates
what the item gains (`presentation`, `metadata.execution` carried through) and says nothing about what it
loses. Two outcomes, both live: a builder who deletes `context` from the type breaks `NodeRoom.tsx:246` at
compile time (loud, fine), and a builder who leaves the field and stops populating it ships a Legacy row
that silently renders nothing where it used to render the tool's salient argument — while Console, which
never read the field, is unaffected. That is a shell divergence introduced by a core deletion. AD-6 should
say `context` is removed from the item and `presentation` replaces it at that render site.

### F4 — the status glyph is the one row datum both shells must render identically, and no AD owns it (medium)

The SPEC makes it a hard constraint: "Status must be decodable **without colour** — a glyph character
carries it" (SPEC, Constraints). The UX spine fixes the five characters and their required hidden accessible
names (`✓ ✕ ◐ ⚠ –`; `succeeded`/`failed`/`running`/`interrupted`/`unknown`, EXPERIENCE.md Accessibility
Floor). The architecture spine mentions none of it, and `ToolPresentation`'s enumerated fields
(`label`, `headline`, `headlineKind`, `badges`, `body` — AD-1) contain no glyph. Glyph selection therefore
lands where AD-1 positively grants freedom ("a shell may choose markup"), on the one axis where two shells
diverging is an accessibility regression rather than a cosmetic one. The mapping source exists and is
already shared (`AgentHistoryItem.outcome`, `agent-history.ts:36`), so this is cheap to assign — say the
glyph and its accessible name come from the core, or say explicitly that the UX spine owns them and AD-1
does not override it.

---

## 2. Is every AD's Rule enforceable, and does it prevent its stated "Prevents"?

| AD                              | Enforceable?                                                                      | Prevents what it claims?                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| AD-1 one core two shells        | **No mechanism** — see F5                                                         | Partly; the fields it bans must stay on the item for CAP-7                                                                  |
| AD-2 boundary is the lint rule  | Yes — CI lint + the existing console isolation test                               | Yes, and it is the strongest AD in the document                                                                             |
| AD-3 core is total              | Review/tests only, and false as written — see F6                                  | Containment yes, premise verified (one boundary, `App.tsx:23-64`); its **redaction** half fails on the Codex path — see F5b |
| AD-4 `diff` + mapper            | Partly — the dependency is enforceable, the call site and bound are not (F2, F2b) | Yes for "each shell growing its own differ"                                                                                 |
| AD-5 types from `api.generated` | Yes — the console isolation test fails on a `@/lib/api` import                    | Yes; verified the base rule has no `allowTypeImports`                                                                       |
| AD-6 flat return                | Yes for the return type (type-check); no for group contents (F3)                  | Partly — the return half yes, the reasoning half no                                                                         |
| AD-7 no memoization             | Review only; adequate for a negative                                              | Yes, but its cost claim does not cover the diff (F2)                                                                        |
| AD-8 no runtime switch          | Yes — a flag or migration would be visible in the diff                            | Yes                                                                                                                         |

### F5 — AD-1 forbids the shell the exact fields CAP-7 forces onto it (medium)

AD-1's Rule: a shell "may not inspect `input`, `output`, or a tool name" — prose, with no pattern, no type
barrier, and no test.

It is unenforceable in a specific way worth naming: `input` and `output` stay on `AgentHistoryItem`
(`agent-history.ts:34-35`) and must stay, because CAP-7's Raw toggle renders them. So the shell is handed
exactly the fields AD-1 forbids it to read, with nothing distinguishing "render raw" from "branch on it".
Either accept that AD-1 is a review-time convention and say so, or give the enforcement a home (a lint rule
on the shells, or a branded type that only the Raw toggle unwraps).

A softer note alongside it: AD-2 declares that "anything a shell must not reach is expressed by adding a
pattern to that rule, never by prose in a document." AD-2 is scoped to _import_ boundaries and AD-1 is about
fields, so this is not a strict contradiction — but AD-1 is still a prose shell-prohibition sitting one
paragraph below a rule that says prose shell-prohibitions do not hold, and a builder is entitled to notice.

### F5b — AD-3's redaction rule logs the payload on the Codex path (medium-high)

AD-3 and the Logging convention row both say: log "the tool name and the error message only — never the
payload, which can carry user content", citing AGENTS.md's ban on logging user content. On the largest
single path in the corpus that rule logs exactly what it protects.

The SPEC's own constraint states that "Codex sets the tool name to the entire shell command", and the
contract's Tier 3 is blunter: "**The name is frequently multi-line.** Real rows carry whole shell scripts as
the tool name — loops, `&&` chains, heredocs", covering 4,911 of 22,867 rows — 21% — which the contract
calls "a main path, not an edge case". For those rows `name` **is** the payload. A caught parse error would
write a whole heredoc — plausibly containing file contents, credentials pasted into a command, or user
prose — into the browser console, under a rule written to prevent precisely that.

The safe field already exists in the spine's own data model: `presentation.label` is capped at a single
token of ≤24 characters and falls back to the family name exactly when the name is long or multi-line, and
`family` is always short and provider-neutral. Log one of those, never the raw `name`. This is a two-word
fix to AD-3 and to the Logging convention row, and it is the only finding here with a user-data consequence
rather than a consistency one.

### F6 — AD-3 says the core never throws; AD-5 moves a throwing function into the core (medium)

AD-3: "no function in the core throws." AD-5: the adapter moves into `packages/web/src/lib/` and "its
internal `requiredLine()` throw is contained by AD-3 at the call site." Verified — `requiredLine()` throws
`Invalid git hunk change` at `packages/web/src/components/workflows/source-control/git-hunk-adapter.ts:5-10`,
and after AD-5 that file is core.

So the invariant is false the moment AD-5 lands, and the rule actually intended — no throw escapes a core
**entry point** — is never written. As stated, a builder either believes the core is throw-free and omits
the containment, or notices the contradiction and guesses. Restate as "no core entry point propagates a
throw; internal helpers may throw and are caught at the entry point", which is what AD-5 already assumes.

---

## 3. Could anything under Deferred let two units diverge?

No. Each deferral is either closed by an AD (memoization → AD-7 fixes it at "none"; the error boundary →
AD-3 removes the trigger), explicitly out of the spec (chat card, Legacy deletion), or pushed upstream with
an owner named (the parent AD-4 amendment). "Virtualising very long transcripts" correctly notes the core
would not change. Deferred is clean.

---

## 4. Is named technology verified-current?

Yes, all four rows check out (verified against the npm registry and the packaged declarations, 2026-09-12):

- `diff` (jsdiff) **9.0.0** is `dist-tags.latest`, published 2026-04-13, and ships `types:
libcjs/index.d.ts` — so "bundles its own types, so no `@types/diff`" is correct. It is genuinely new to
  `@archon/web` (absent from `packages/web/package.json`; present in `bun.lock` only transitively —
  `diff@8.0.3` via astro, `8.0.4` via pi-coding-agent).
- `structuredPatch` still exists in v9 and `StructuredPatchHunk` is exactly
  `{oldStart, oldLines, newStart, newLines, lines: string[]}` (`libcjs/types.d.ts:252-258`) — the spine's
  mapper description is accurate. The only defect is the `undefined` claim (F2b).
- `react-diff-view` 3.3.3, `highlight.js` ^11.11.1, `rehype-highlight` ^7.0.0 — all three declared in
  `packages/web/package.json:27,41,46` as stated.

---

## 5. Does it ratify the brownfield? (every cited `file:line` verified)

**All seven citations are correct.** This is unusually good and worth recording, because several are the
kind that rot.

| Citation                          | Verdict                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `eslint.config.mjs:126-163`       | Correct — the console config object opens at `126` and closes at `163` (file is 164 lines); the `no-restricted-imports` patterns are `129-160` |
| `App.tsx:23-64`                   | Correct — `class ErrorBoundary` opens at 23, closes at 64                                                                                      |
| `api.ts:472-473`                  | Correct — `GitDiffHunk` / `GitDiffChange` as plain `components['schemas']` aliases                                                             |
| `ConsoleNodeRoom.tsx:607`         | Correct — `buildAgentHistory({`                                                                                                                |
| `ConsoleExecutionHistory.tsx:204` | Correct — `buildAgentHistory({`                                                                                                                |
| `NodeTranscriptPane.tsx:236`      | Correct — `buildAgentHistory({`                                                                                                                |
| `App.tsx:93-95`                   | Correct — the `/legacy` deprecation comment, "Removed from the codebase once the console has proven itself"                                    |

Unstated claims also verified true: `packages/web` has exactly **one** error boundary (nothing outside
`App.tsx` defines `getDerivedStateFromError` / `componentDidCatch`), so AD-3's premise holds; Console imports
**nothing** from `@/lib/api` today; Console imports 13 distinct `@/lib` paths, which is the evidence AD-2
rests on; the base `no-restricted-imports` rule carries no `allowTypeImports`, so AD-5's reasoning is sound;
`git-hunk-adapter.ts` is 57 lines with exactly two consumers (`virtualized-diff.tsx` and its test), as AD-5
says; `WorkflowNodeMessage.metadata` is `{ execution?: { occurrence_id, … } } | null` — optional **and**
nullable, exactly as AD-6 asserts (`api.generated.d.ts:5206-5234`); and `buildAgentHistory()` really is
unmemoized at all three sites, each a plain expression in the component body with no `useMemo` in scope, so
AD-7's premise is sound.

### F7 — one brownfield fact AD-1 neither ratifies nor migrates (medium-low)

`selectNodeRoomMessages` already exists **twice**, once per shell: Legacy at
`packages/web/src/components/workflows/NodeRoom.tsx:90` and Console at
`packages/web/src/experiments/console/components/inspect/select-node-room-messages.ts:7`. It is not markup —
it slices a loop iteration out of a row list by matching `iteration_started` / `iteration_completed` status
markers, which is a decision about what a row means, and it sits directly upstream of every
`buildAgentHistory()` call.

AD-1 ("every decision about _what a row means_ is made in `lib/`") is therefore already violated on day one,
by code this feature builds on top of. The spine should either grandfather it explicitly (one line: "the
existing per-shell iteration slicer is out of scope and stays forked") or fold it in. Silence invites a
builder to either do an unbudgeted consolidation or conclude AD-1 is aspirational.

### F8 — `lib/` is not uniformly the pure core AD-2's headline sentence implies (low)

AD-2: "`packages/web/src/lib/` is shared ground both shells may import." Two sentences later the same AD
concedes Console "imports nothing from `@/lib/api` today and must import nothing from it after this work" —
and `@/lib/api` is in `lib/` and is banned by the very lint rule the AD cites. The Design Paradigm has the
same shape of overstatement: "The core is pure TypeScript in `packages/web/src/lib/`: no React, no DOM, no
fetch" — true of this feature's modules, false of the directory, which holds `api.ts` (fetch) and
`use-container-split-mode.ts` (a React hook that Console imports).

Both are self-corrected in context, so this is low. But the quotable sentence is the wrong one, and a spine
is quoted.

---

## 6. Does it cover CAP-1..CAP-7 of the driving spec?

All seven appear in the Capability → Architecture map with a home and a governing AD, and the CAP-id
collision with the parent's HITL `CAP-1..CAP-7` is called out explicitly — a real hazard, well handled.

Coverage gaps, all already raised: CAP-3 has a module but no return slot (F1); CAP-5 has a differ but no
call site (F2); CAP-6 has a key but no group contents and an ambiguous input (F3). CAP-1's accessibility half
is unowned (F4).

Two spec criteria have no owner anywhere in the spine and are not deferred either. Both are low, because
both are measurable in test rather than divergence-prone:

- CAP-2's "the generic fallback claims **under 2%** of rows, measured against the production corpus" — an
  acceptance threshold with no home.
- The SPEC constraint "No raw `JSON.stringify` as a default presentation **anywhere**" is implied by AD-3's
  generic arm and CAP-7's toggle but never stated as an invariant, even though the SPEC calls it "the defect
  being fixed" and warns that re-introducing it in a fallback path fails the spec. AD-3 sends unparseable
  input to the generic arm — worth one clause saying that arm still never stringifies.

---

## 7. Do the new ADs weaken or contradict inherited AD-3 / AD-4?

**No, and the AD-4 correction is handled honestly** — this was the item most likely to be a silent override,
and it is not one.

The spine (a) restates the parent's prohibition list unchanged in Inherited Invariants, (b) names the stale
clause in a labelled **Correction** paragraph rather than quietly dropping it, (c) grounds the correction in
lint evidence rather than preference, (d) says explicitly "The parent's prohibition list stands unchanged;
only its exception-counting sentence is wrong", and (e) files the upstream amendment under Deferred with the
owner named ("Belongs to the HITL spine's own Update, not to a local override here"). The memlog shows the
same discipline — the conflict was logged, closed on evidence, and routed upstream.

The evidence holds: the enforced patterns are exactly `@/components/**`, `@/contexts/**`, `@/hooks/**`,
`@/routes/**`, `@/stores/**`, `@/lib/api`, `@tanstack/react-query` — the same set the parent's prose lists —
and `@/lib/*` is unrestricted, which the rule's own comment at `eslint.config.mjs:122-123` states. Console's
13 `@/lib` imports make "one sanctioned exception" factually dead. Set-for-set, AD-2 removes nothing the
parent enforced.

Inherited AD-3 is ratified without qualification: no new source, no new column, `seq` order preserved — and
the spine correctly identifies that as the reason the feature is retroactive.

One small omission: the parent's AD-4 also carries "Each surface owns its React/SVG shell", which the spine
keeps, and the parent's Logs convention ("Unmerged node-**run** rows, iteration = its own row"), which the
spine does **not** mention — and that convention is exactly what makes F3(b) live. Not a contradiction; an
unexamined interaction.

---

## 8. Is every dimension this altitude owns decided, deferred, or open?

Decided: module placement, purity/error policy, dependency ownership, type provenance, API stability,
memoization, naming, logging, the validation gate, and — notably — the **operational envelope**, which AD-8
handles properly: no flag, no env var, no config key, no migration, no route, no deploy step, rollback =
revert, one named cost (bundle size, one dependency). That is the dimension most often left silent at this
altitude and it is the cleanest AD in the document.

Silent or under-owned:

- **Accessibility** — F4. The one dimension where two independently-built shells diverging is a defect
  rather than a difference, and no AD touches it.
- **The UX contract's authority over the shells** — the SPEC adopts `DESIGN.md` / `EXPERIENCE.md` as spines
  that "own how the transcript looks and how it behaves, and they win over any mockup". The architecture
  spine lists them in `companions:` and then never refers to them, while AD-1 positively grants shells
  "markup, class names, and layout". Read alone, AD-1 licenses a builder to ignore the Accessibility Floor,
  Component Patterns, Elision priority and Occurrence grouping labels that already exist. One clause
  deferring to them fixes it. **(medium-low)**
- **Test ownership** — `test-plan.md` is in `sources:` but not `binds:`, and no AD or convention row points
  to it; the Gate row says only "`bun run validate`". AD-3 stakes correctness on "tests over real payloads"
  without naming where that plan lives. **(low)**

Nothing else at this altitude is missing. Data/format provenance, error policy, logging redaction, and
comment/test-naming discipline all have convention rows.

---

## Internal self-contradictions (consolidated)

1. **AD-3 vs AD-5** — the core never throws / a throwing function moves into the core. (F6, medium)
2. **AD-1 vs AD-2** — prose prohibitions are illegitimate (AD-2) / AD-1 is a prose prohibition. (F5, medium)
3. **AD-6 vs the Capability map** — the return is unchanged `AgentHistoryItem[]` / the node-level todo fold
   happens inside `buildAgentHistory()`. (F1, high)
4. **AD-2 internal** — `lib/` is shared ground both shells may import / except `@/lib/api`, which is in
   `lib/`. (F8, low)
5. **Structural seed vs the canonical contract** — the seed names `todo-fold.ts`; the contract declares the
   module as `packages/web/src/lib/todo-state.ts` exporting `projectTodoState`
   (`todo-fold-contract.md:10,24`) and the test plan names `todo-state.test.ts`
   (`test-plan.md:40`). The spine renames it silently, while flagging two other contract corrections
   explicitly (the adapter's real path, the `structuredPatch` shape). A builder following the seed produces
   `todo-fold.ts` and leaves a dangling test-plan reference. **(medium — pick one name and correct the other
   document out loud)**

---

## Claims asserted without evidence

Very few — the document is unusually well-sourced, and the memlog carries the rest. Three:

1. **"At CAP-1's stated scale — forty rows — the resolver costs microseconds"** (AD-7). Plausible for a
   name-normalise plus key lookup, and nothing turns on the exact figure for the resolver. It is asserted
   rather than measured, and it is then used to price a decision that also covers the diff path, which it
   does not describe. (See F2.)
2. **"Revisit when a node's row count reaches the low hundreds while live-streaming"** (AD-7). A revisit
   trigger with no stated basis and no way to observe it — nothing counts rows or warns. Acceptable as a
   judgement call; worth knowing it is one.
3. **"they are plain aliases over `components['schemas']` … so the move stays mechanical"** (AD-5). The
   alias half is verified true (`api.ts:472-473`). "Mechanical" is the inference, and it is contradicted in
   spirit by AD-5's own final sentence — the moved file contains a throw that now needs containment under
   AD-3. Small, but "mechanical" is doing work it has not earned.

---

## What would close this

Seven clauses, no restructuring:

1. AD-6: state where the folded todo state and the anchor flag live in the returned array. (F1)
2. AD-4: name the call site of the mapper, and pin `maxEditLength` or `timeout` with a value. (F2, F2b)
3. AD-6: state the group's shape including the label, and which row set the grouper consumes. (F3)
4. AD-6: say `context` leaves the item and `presentation` replaces it at `NodeRoom.tsx:246`. (F3c)
5. AD-3 + Logging row: log `presentation.label` or `family`, never the raw tool name. (F5b)
6. AD-3: restate as "no core **entry point** propagates a throw". (F6)
7. One clause deferring shell look-and-behaviour to the adopted UX spines, and naming the glyph +
   accessible name as core data. (F4, and the UX-authority gap in §8)

Then reconcile `todo-fold.ts` / `todo-state.ts` with the contract, out loud.

---

## Unresolved questions

- Is F3(b) intended? If the occurrence-scoped entry path is _meant_ to render one occurrence with no header,
  CAP-6 is satisfied and the grouper exists only for the `kind: 'node'` path — say so, and the finding
  becomes one sentence rather than a design change.
- Does the diff run eagerly or on expand? The answer changes whether AD-7 needs a second justification.
- Who owns the glyph — core or the UX spine? Either is fine; the spine must pick one.
- Is `selectNodeRoomMessages` in scope? If not, AD-1 needs a grandfather clause.
- Does `context` leave `AgentHistoryItem` entirely, or stay and go empty? The first is a compile error at
  one known line; the second is a silent Legacy-only regression.
