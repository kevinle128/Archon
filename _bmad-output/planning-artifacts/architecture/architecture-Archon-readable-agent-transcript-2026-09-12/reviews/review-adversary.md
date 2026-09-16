---
lens: adversarial — divergence under full compliance
target: ../ARCHITECTURE-SPINE.md
date: '2026-09-12'
verdict: 'Spine is sound in shape and wrong in reach. Two builders can obey every AD and still ship two different transcripts. 2 blocking, 5 high.'
---

# Adversary review — Readable Agent Transcript (Track A) spine

## Method

The attack unit is a **pair of deliverables one level below the spine** — the Legacy shell and the
Console shell, or two stories inside the core — where each one obeys every AD to the letter and the
two still build incompatibly. Every pair below is reachable from the shipped code, not imagined.
Line citations are from the working tree at the time of review.

The spine's paradigm is correct: a pure core, two markup shells. The failure is **reach**. AD-1
draws the core/shell line at five fields of `ToolPresentation`. The row contract in
`EXPERIENCE.md` needs about nine more derived values, and no core type carries any of them. Every
one of those values is a decision about _what a row means_, so every one is a legal fork.

---

## A-1 — BLOCKING — CAP-3 has no carrier, and AD-6 forbids the natural one

**Unit A** — the story that builds the fold. It ships
`projectTodoState(inputs: readonly unknown[]): TodoPhase[]` exactly as `todo-fold-contract.md:24`
declares it. Pure, total, in `lib/`. AD-1, AD-3 and AD-6 all satisfied.

**Unit B** — the story that renders the checklist. It needs `TodoPhase[]` for the node, plus a flag
saying which todo call is the last one, because `todo-fold-contract.md:83` anchors the checklist at
the last call and collapses the earlier ones to `todo updated`.

**The clash.** AD-6 pins the return of `buildAgentHistory()` to `AgentHistoryItem[]` and lists only
one addition, `presentation` on each tool item. `AgentHistoryItem` has no todo field
(`agent-history.ts:18-48`) and no "last todo call" flag. So the folded state has nowhere to go, and
three readings are all legal:

- attach `TodoPhase[]` to the last todo item only;
- attach the same array to every todo item;
- do not attach it at all — each shell imports `projectTodoState` and feeds it the `input` of every
  item it recognises as a todo call.

The third reading is the one a blocked builder takes, and it makes the shell identify a tool family
and read `item.input` — the exact act AD-1 forbids. The first two produce different DOM. The spine
says CAP-3 is "folded in `buildAgentHistory()`" (Capability → Architecture Map) and then removes the
only place to put the result.

**Fix — tighten AD-6.** State the carrier: `buildAgentHistory()` returns `AgentHistoryItem[]` where
the tool variant gains `presentation`, `execution`, and `todo: { phases: TodoPhase[]; isAnchor:
boolean } | null` — non-null on todo-family items only, `isAnchor` true on the last one. No shell
calls `projectTodoState`.

## A-2 — BLOCKING — AD-3 says the core never throws; AD-5 ships a core module that throws

**Unit A** — the story that moves `git-hunk-adapter.ts` into `lib/`. AD-5 tells it the move is
mechanical and that "its internal `requiredLine()` throw is contained by AD-3 at the call site". It
leaves the throw in place. Compliant.

**Unit B** — the story that writes the `structuredPatch` → `GitDiffHunk` mapper. AD-3 tells it "no
function in the core throws". It calls the adapter without a guard, because a core function does not
throw. Compliant.

**The clash.** Neither story owns the containment that AD-5 assigns to "the call site". One
malformed hunk then throws during render and lands the whole web UI on the full-screen error page at
`App.tsx:23-64` — the permanently-unopenable run that AD-3 exists to prevent. The two ADs each point
at the other.

The premise is also already false: `lib/pair-tool-transcript.ts:124` throws
`tool card requires a call or result row` today, inside the core, before this work starts. "The core
is a total function" is an aspiration stated as a fact, so a third builder may "repair" that thrower
and change pairing behaviour instead.

**Fix — rewrite AD-3 as a rule about exports and name the owner.** Every function _exported from_
`lib/` for this feature returns a degraded value and never throws; an internal helper may throw only
when its single caller wraps it, and that caller is named in the AD. Add: `git-hunk-adapter` is
wrapped by the mapper, not by the shells. Record `pair-tool-transcript.ts:124` as a known
pre-existing thrower that this work does not touch.

## A-3 — HIGH — AD-1 names five fields; the row contract needs about nine more

This is the umbrella. Each item below is a rendered value the reader sees, is decided from payload
or row state, and is carried by no core type. AD-1 says the shells "consume as given" —
`label`, `headline`, `headlineKind`, `badges`, `body`. Both shells consume those five as given and
still differ, because the rest of the row is built in the shell from prose.

| Value the reader sees                                    | Where it is specified                     | Where it would be computed today        |
| -------------------------------------------------------- | ----------------------------------------- | --------------------------------------- |
| Status glyph, and its visually-hidden name               | `EXPERIENCE.md:91`, `:172`                | each shell                              |
| Exit code on the collapsed row                           | SPEC "Success signal"; `EXPERIENCE.md:94` | **nowhere — see A-3a**                  |
| Duration badge                                           | `EXPERIENCE.md:94`                        | each shell, from `item.durationMs`      |
| Truncation markers                                       | `EXPERIENCE.md:94`, `:132`                | each shell, from `item.outputState`     |
| Final badge order                                        | not specified                             | each shell — see A-3b                   |
| Body-bar facts (`1 hunk`, `replace_all: false`, `cwd …`) | `EXPERIENCE.md:96`                        | each shell, from `input`                |
| `folded from 5 todo calls`                               | `EXPERIENCE.md:96`                        | nowhere                                 |
| Folded-todo badge `op: <op>`                             | `EXPERIENCE.md:106`                       | each shell, from `input.op` — see A-3c  |
| Collapse default                                         | `EXPERIENCE.md:90`, `:119`, `:126-127`    | each shell — see A-5                    |
| Occurrence header label                                  | `tool-presentation-contract.md:194`       | each shell, from raw metadata — see A-7 |

**A-3a — the exit code exists and is thrown away.** `extraToolFields()` reads
`metadata.exit_code` at `agent-history.ts:104-118`, `deriveOutcome()` uses it at `:129`, and the
item never carries it. `ToolPresentationInput` is `{name, input, output}`
(`tool-presentation-contract.md:12-16`), so the presenter cannot see it either. CAP-1's success
signal — "the one failing `bash` call … visible with its command and its exit code without a single
click" — is therefore unimplementable as specified. Unit A adds `exitCode` to `AgentHistoryItem`.
Unit B reads `exit 1` out of the output text in the shell, which works for Claude and silently fails
for every provider that formats differently. Both ship.

**A-3b — badge order is a shell decision by construction.** `presentation.badges` can only hold
facts the presenter can see, so duration, truncation markers and the exit code must be appended by
the shell from `item`. `EXPERIENCE.md:94` fixes the _drop_ priority under width pressure and never
fixes the _render_ order. Legacy emits `exit 1 · 2.4s · truncated`; Console emits
`truncated · 2.4s · exit 1`. Both consumed `presentation.badges` as given.

**A-3c — the folded-todo badge forces a renderer to learn a provider.** `op: <op>` exists only in
OMP's payload; Claude's `TodoWrite` has no `op` at all (`todo-fold-contract.md:31-37`). A shell that
renders that badge reads `input.op` and branches on a provider shape — the single thing the SPEC
constraint at line 68 and AD-1 both ban. No core module is assigned to produce it:
`toolPresentation` has no todo arm by design (`tool-presentation-contract.md:58`) and
`projectTodoState` returns phases, not per-call badges.

**Fix — one tightened AD-1.** Replace "`label`, `headline`, `headlineKind`, `badges`, and `body` are
consumed as given" with: _every value a shell renders is a field on a core row view-model; a shell
that derives a rendered string from `item` — from `input`, `output`, `name`, `metadata`, `outcome`,
`outputState`, `durationMs` or a raw payload — is the violation._ Then enumerate the view-model:
`glyph`, `glyphName`, `label`, `headline`, `headlineKind`, `badges` (final, ordered, including
duration, exit code and markers), `badgeDropOrder`, `bodyBarFacts`, `body`, `initiallyExpanded`,
`raw`. Note that AD-1's current prohibition list names only `input`, `output` and the tool name — it
does not mention `metadata`, `outcome`, `outputState` or `durationMs`, which is where all the
remaining derivation actually lives.

## A-4 — HIGH — the glyph map is unowned, and two rules give opposite glyphs on a reachable row

**The row.** A result row with `metadata.tool_phase: 'result'`, `metadata.outcome: 'success'`, and
no `payload.output`. Then `pending` is false (`pair-tool-transcript.ts:134`), `deriveOutcome()`
returns `succeeded` (`agent-history.ts:132`), and `deriveOutputState()` returns `missing`
(`agent-history.ts:100`).

**Unit A** follows `EXPERIENCE.md:91`: the glyph is "derived from `AgentHistoryItem.outcome` via
`deriveOutcome()`, unchanged" → `✓`.
**Unit B** follows `EXPERIENCE.md:131`: "Output missing | Glyph `–`" → `–`.

Both cite the same document, one section apart. The glyph is the entire colour-free status contract
(SPEC constraint, line 65), so this is the one value that must not fork. Nothing in the core maps
outcome to a character: `ToolPresentation` has no glyph field, and the mapping lives twice, in prose.

**Fix — add an AD.** The core exports one function from `(outcome, outputState)` to
`{ glyph, glyphName }`. State precedence explicitly: `outputState` overrides `outcome` for the
`missing`/`unknown` cases, or it does not — but state it once, in code.

## A-5 — HIGH — "expanded on failure" has three legal readings, and they fork on a live run

Both rooms poll every 1000 ms (`NodeTranscriptPane.tsx:186`, the matching drain in
`ConsoleNodeRoom.tsx`), so `buildAgentHistory()` re-runs about once a second during a run.

**Unit A** writes `<details open={item.outcome === 'failed'}>`. A row that fails mid-run opens
itself, which is `EXPERIENCE.md:127`. A succeeded row the reader opened snaps shut on the next poll,
which contradicts `EXPERIENCE.md:128`.
**Unit B** writes an uncontrolled `<details>` with the outcome applied only at mount. The reader's
open row survives, which is `:128`. A row that fails live never opens, which contradicts `:127`.

Both readings are in the same document; neither is in the spine. Row identity is not the problem —
`key={item.id}` is `card.id`, the call row's id (`pair-tool-transcript.ts:130`), so the DOM node and
its native open state survive a poll. The fork is controlled versus uncontrolled.

CAP-1 also names only two of the five outcomes ("Successful calls are collapsed … and failed calls
are expanded"). `running`, `interrupted` and `unknown` have glyphs and badges in
`EXPERIENCE.md:129-133` and no open-state rule at all.

**Fix.** The core emits `initiallyExpanded: boolean` covering all five outcomes. The AD states the
row is uncontrolled after first render, and that a row which transitions to `failed` while mounted
opens once and then stays under reader control.

## A-6 — HIGH — the Codex headline: the contract and the UX spine disagree, and only a shell can bridge

`tool-presentation-contract.md:133-137` — Tier 3, the Codex path, 4,911 of 22,867 real rows: family
`shell`, headline is "the **first non-empty line** of the name, with a trailing `…` when more lines
follow". No stripping.

`EXPERIENCE.md:93` — "Codex names lose the fixed `/bin/zsh -lc '` or `/bin/bash -lc '` prefix and
closing quote, **then** the first non-empty line plus `…` when more follow."

**Unit A** implements the presenter from the machine contract, so every Codex headline begins
`/bin/zsh -lc '`. **Unit B** implements the shell from the UX spine and trims `item.name` before
rendering — reading the tool name, which AD-1 forbids by name. Whichever way each builder resolves
it, 21.5 % of all rows get two different headlines on the primary scan line, and one resolution is
an AD-1 violation that no lint rule catches.

**Fix.** The prefix strip belongs in the presenter. Amend `tool-presentation-contract.md` Tier 3,
and have the spine record which document wins when the machine contract and the UX spine describe
the same string. Today neither the SPEC nor the spine says.

## A-7 — HIGH — occurrence grouping: three unpinned decisions, one of which breaks CAP-6 directly

**(a) Do assistant and lifecycle items group?** `EXPERIENCE.md:43` says each group "interleaves
assistant text and tool rows". AD-6 says `buildAgentHistory` carries `metadata.execution` through
while gaining `presentation` "on each tool item" — read literally, execution rides tool items only.
`WorkflowNodeMessage` carries `metadata.execution` on all three variants (text, tool and status —
`api.generated.d.ts:5206`, and the two following variants), so the data exists; the spine just does
not say it travels. Unit A groups every item kind. Unit B groups tool items and leaves prose
floating between groups. Different transcripts, same rows.

**(b) What happens to a row with no execution?** AD-6: "a row without `execution` belongs to one
implicit group and renders no header". On a node where _some_ rows carry execution and some do not —
the `unknownScope` case both rooms already warn about (`NodeRoom.tsx:33`,
`ConsoleAgentHistoryList.tsx:16-17`) — two readings follow. If the implicit group is a _group_, a
single-occurrence node with a few unscoped rows renders headers, which fails CAP-6's stated success
criterion ("a single-occurrence node renders none"). If it is not, two real executions merge with no
divider, which is the exact confusion CAP-6 exists to remove, in the one case where the UI already
knows it is confused.

**(c) The header label.** `tool-presentation-contract.md:194` says "label from `retry_epoch` and
`loop_ancestry`" and gives no format. If the grouping function returns
`{ occurrenceId, items }` without a rendered label, each shell derives user-visible text from raw
metadata — which AD-1's prohibition list does not cover, since it bans only `input`, `output` and
the tool name.

**Fix — extend AD-6.** Execution travels on every item kind. The group is
`{ key, label, items }` with the label rendered in the core. Rows with no execution form a
**distinct trailing group that never counts toward the "more than one group" test** and carries the
existing unknown-scope notice instead of a header. Group order is by the lowest `seq` in the group.

## A-8 — MEDIUM-HIGH — Console's tool-call filter versus the fold and the groups

Console ships a persisted, user-facing checkbox — `archon.console.showToolCalls`
(`experiments/console/README.md:61`, `StreamToolbar.tsx:182`) — and
`ConsoleAgentHistoryList.tsx:263` drops every tool item when it is off. Legacy has no such control.

After this work, the todo checklist is anchored on a tool item and the occurrence headers wrap tool
items. So Console with tool calls hidden deletes the agent's checklist, and may render group headers
around nothing, while the same node in Legacy shows both. The spine never says whether the fold and
the grouping sit above or below a shell's visibility filter, so both behaviours are compliant.

The two Console consumers already differ, which is the live proof: `ConsoleNodeRoom.tsx:742-760`
passes `renderAfterItem` so Ask cards anchor inline; `ConsoleExecutionHistory.tsx:297-307` passes
none and pushes them to `renderAtEnd`. Same core array, two placements, no AD touching it.

**Fix.** State that the fold and the grouping run on the full item list before any shell filter, and
that a shell filter may hide rows but never changes which row is the checklist anchor or whether a
header renders.

## A-9 — MEDIUM — "degraded" means three different things inside one spine

AD-3 asserts one meaning: "anything unparseable resolves to the `generic` arm". The other two are
elsewhere in the same document set:

- `projectTodoState` degrades to `[]`, which renders nothing (`todo-fold-contract.md:81`). Not a
  generic arm; there is no todo arm at all.
- `structuredPatch` past its bound degrades to path-plus-preview and **keeps** family `file`
  (AD-4). A third shape.

So for a `task` payload that will not parse: **Unit A**, owning `task-normalize`, returns
`{ kind: 'task', context: '', subtasks: [] }` and keeps the family, because the tool _is_ a task.
**Unit B**, owning `tool-presentation`, reads AD-3 literally and demotes the row to `generic`. Same
row, a task card on one surface and a `key: value` list on the other. Both cite AD-3.

**Fix.** Pin it: a family that matched keeps its family and renders its arm with empty content;
`generic` is only for a payload that matched no family. Note the two named exceptions (todo → `[]`,
diff → path-plus-preview) in AD-3 itself so they stop reading as contradictions.

## A-10 — MEDIUM — Raw is governed by nothing

CAP-7's payload is not in `ToolPresentation`, and the spine's map says only "both shells; payload
carried on the item". Three unpinned questions, each a fork:

1. **What are "the exact bytes"** — `item.input`, `{input, output}`, or the row payload with its
   metadata? `EXPERIENCE.md:104` says "the provider's JSON" and does not choose.
2. **Which output does Raw show** once the reader has pressed "View full output"? Both shells hold
   that in local `useState` (`NodeRoom.tsx:203-204`, `ConsoleAgentHistoryList.tsx:133-137`).
   `EXPERIENCE.md:97` says Raw _swaps_ the body and `:132` says the full-output control stays below
   it — so the two controls now overlap and nothing says which wins.
3. **How the bytes are produced.** `formatToolIo` (`pair-tool-transcript.ts:75`) already returns a
   string unchanged or `JSON.stringify(value, null, 2)`. It is shared, so use it — but no AD says so,
   and the SPEC's hardest constraint is precisely "no raw `JSON.stringify` as a default presentation".
   A shell that reaches for `JSON.stringify` directly in the Raw box is one edit away from reaching
   for it in a fallback.

**Fix.** Put `raw: string` on the row view-model, produced once in the core from the same bytes on
both surfaces, and state that it reflects the currently displayed output.

## A-11 — MEDIUM — AD-2 licenses what AD-1 forbids, in one direction

AD-2: "the boundary is the `no-restricted-imports` patterns at `eslint.config.mjs:126-163`, and
nothing beyond them … never by prose in a document."
AD-1: "Neither shell imports from the other."

The lint block is scoped to `files: ['packages/web/src/experiments/console/**/*.{ts,tsx}']`. Console
cannot import `@/components/**`; **Legacy can import `experiments/console/**` freely.\*\* By AD-2's own
standard, AD-1's second half is unenforced prose, so a Legacy builder may legally import a
Console-owned helper. AD-2 is otherwise correct and its correction of the parent's stale
exception-counting sentence is right.

The related gap: AD-2 _permits_ `lib/` as shared ground and no AD _requires_ a decision both shells
render to land there. Two duplicates prove the drift vector is live — byte-identical today, two
owners tomorrow:

- `selectNodeRoomMessages` — `components/workflows/NodeRoom.tsx:90` and
  `experiments/console/components/inspect/select-node-room-messages.ts:7`. This one decides **which
  rows the transcript sees**, upstream of the whole core.
- `formatDurationMs` — `lib/format.ts:28` and `experiments/console/lib/format.ts:17`. This one
  formats a badge the new design puts on every row.

**Fix.** Add the reverse lint pattern (`components/**` must not import `experiments/**`), and add to
AD-2: any function whose output both shells render lives in `lib/`.

## A-12 — MEDIUM — module names and type homes disagree between the spine and its own contracts

- Spine Structural Seed: `todo-fold.ts`. `todo-fold-contract.md:10`:
  `packages/web/src/lib/todo-state.ts`. Two builders, two files, possibly both.
- `TaskSubtask` is declared inside the `tool-presentation.ts` block at
  `tool-presentation-contract.md:49-53`, while the spine assigns it to `task-normalize.ts`. Two
  declarations compile happily while structurally identical, and drift the moment one of them gains
  `model` (which Claude's `AgentInput` already carries —
  `tool-presentation-contract.md:206`).

**Fix.** One file name and one owning module per exported type, written once, in the spine's
Consistency Conventions.

## A-13 — LOW — AD-7 is a fact about this PR, not a rule on shells

"the presenter is attached inside `buildAgentHistory()`, which is unmemoized … so no memoization is
added now" describes the change. Its **Prevents** clause wants a binding rule ("one builder adding
`useMemo` and another not"). As written, a later Console PR adding `useMemo` violates nothing.

**Fix.** "Neither shell wraps `buildAgentHistory()` or its row components in `useMemo` /
`React.memo`. If one does, both do, in one change." Keep the revisit condition.

Worth pairing with A-5: the presenter now allocates fresh objects on every 1000 ms poll, so a future
`React.memo` on a row component would be a no-op unless the core also stabilises identity. Say that
in the revisit condition so the future fix is not attempted at the wrong layer.

## A-14 — LOW — AD-6's "keeps its flat return" while a field disappears

The Structural Seed removes `TOOL_CONTEXT_KEYS` and `toolContext()`, which deletes
`AgentHistoryItem.context` — consumed at `NodeRoom.tsx:246` and
`ConsoleAgentHistoryList.tsx:178`. AD-6's stated protection is the _return type_, and the return
type does stay `AgentHistoryItem[]` while both shells break. TypeScript catches it at compile time in
both, so this is wording, not risk. Say "the item shape changes; both shells update in the same
change".

---

## Smaller notes, not pairs

- `PairableToolMetadata.execution` declares `occurrence_id?` and `attempt_id?` as optional
  (`pair-tool-transcript.ts:15-18`) while `api.generated.d.ts:5208-5212` declares both required
  inside `execution`. Harmless today; it means a grouping function written against the pairing type
  must handle a case the wire cannot produce, and one written against the generated type will not.
  Pick one.
- Grouping preserves `seq` order inside a group, but the spine never states the order _of_ groups.
  One function, so no fork — but no test will catch a regression either.
- AD-8's "the only operational delta is bundle size: one dependency, `diff`" is accurate and the
  revert-is-rollback posture is right. No attack found.
- The inherited-AD-4 correction in the spine's preamble is correct and well argued. No attack found.

## Unresolved questions

1. When the machine contract (`tool-presentation-contract.md`) and the UX spine (`EXPERIENCE.md`)
   describe the same rendered string and disagree — A-6 is the proven case — which wins? Neither the
   SPEC nor the spine says, and the SPEC's preamble calls both canonical.
2. Is the row view-model in A-3 acceptable scope, or does the user want `ToolPresentation` to stay
   at five fields and the remaining values pinned by a second core type? Either closes the holes; the
   first is fewer moving parts.
3. Does `showToolCalls` (A-8) stay a Console-only control after this work, or does Legacy get it too?
   The answer changes whether A-8 needs an AD or just a note.
4. For A-7(b): should a node with mixed scoped and unscoped rows show group headers at all? This is a
   product call about whether a partial signal is better than none.
