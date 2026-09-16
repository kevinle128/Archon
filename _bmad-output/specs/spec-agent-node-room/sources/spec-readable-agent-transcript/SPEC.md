---
id: SPEC-readable-agent-transcript
companions:
  - tool-presentation-contract.md
  - todo-fold-contract.md
  - test-plan.md
  - ../../../../planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - ../../../../planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
  - ../../../../planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - ../../../../../plans/260909-2130-live-interactive-agent-view/findings.md
  - ../../../../project-context.md
sources:
  - ../../../../../plans/260909-2130-live-interactive-agent-view/design.md
---

> **⛔ SUPERSEDED — do not build from this spec.** Merged into `../../` (the **read** half, CAP-1…CAP-7, unchanged in number). That unified spec is the live contract; this folder is retained only as a merge `source:` for audit. Read `../../SPEC.md`.

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale this contract intentionally omits. `findings.md` is a required companion, not background: it carries the `file:line` evidence and the real provider payloads every capability below was derived from. `DESIGN.md` and `EXPERIENCE.md` are the UX run's two spines, adopted here rather than summarised: they own how the transcript looks and how it behaves, and they win over any mockup. `ARCHITECTURE-SPINE.md` is the architecture run's spine, adopted the same way: its fifteen `AD`s own where logic lives and which divergences are forbidden. This kernel does not restate any of the three — a reader who needs a colour, a state rule, a keyboard contract, or a boundary goes there.

# Readable Agent Transcript

## Why

A pain to solve.
An operator opening an agent node in either node room sees every tool call rendered as two always-open blocks of pretty-printed JSON, so following what the agent did means reading serialized data instead of a transcript.
Two faults compound: `<details open>` expands input _and_ output by default, so a forty-call node is a wall of JSON, and the only humanising step (`agent-history.ts:171` `toolContext()`) is keyed on `['cmd','path','file_path','query','url']`, which misses `command` and `pattern` and so contributes almost nothing.

The work is worth doing now because it is unusually cheap for its reach.
The transcript is already stored, already served, and already passes through one render-neutral data layer that both surfaces share, so this is a pure function of data in the database today — **it improves every historical run the moment it ships, with no migration and no re-run**.
That is what separates this from the live/interactive work, which needs persistence that does not exist yet and can therefore never apply retroactively.

## Capabilities

- **CAP-1** — Scan a node's work without expanding anything
  - **intent:** A reader can scan a node's tool calls one line each and tell what ran, what it ran on, and whether it worked.
  - **success:** A node with forty tool calls renders forty single-line rows, each carrying a family chip, a status glyph, a headline naming the salient argument, and right-aligned badges. Successful calls are collapsed on first render and failed calls are expanded. No collapsed row contains serialized-data punctuation.

- **CAP-2** — Expand a call into a body shaped for that kind of tool
  - **intent:** A reader can open any tool call and see its input and output rendered for the kind of tool it is.
  - **success:** Every family renders its declared body arm per `tool-presentation-contract.md`. A tool matching no family renders at most three scalar `key: value` pairs, with objects and arrays collapsed to `{…}` / `[n]`, and never a JSON dump. **Measured against the production corpus, the generic fallback claims under 2% of rows** — it is the escape hatch, not a main path.

- **CAP-3** — Follow the agent's checklist as state, not as mutations
  - **intent:** A reader can see the agent's current todo list, with phases and per-item status, instead of a sequence of opaque updates.
  - **success:** Both provider shapes normalize to the same `TodoPhase[]` per `todo-fold-contract.md` — OMP's nine ops fold including the three traps, Claude's whole-list `TodoWrite` folds last-call-wins into one phase. The checklist renders once, anchored at the last todo call; earlier todo calls collapse to a one-line row. A phase emptied by `rm` disappears rather than rendering an empty header.

- **CAP-4** — See what a subagent dispatch asked for
  - **intent:** A reader can see the brief a task dispatch carried and which subtasks it spawned.
  - **success:** Both provider shapes normalize to `TaskSubtask[]` — OMP's batch yields one entry per element, Claude's single dispatch yields exactly one. The card renders batch context as markdown when the provider sends any, then one collapsible card per subtask naming the subtask and its agent.

- **CAP-5** — See what a file edit changed
  - **intent:** A reader can see the actual change a file edit made, inline, without leaving the transcript.
  - **success:** When the payload carries both before and after content, a line diff renders through `react-diff-view`. Claude always qualifies — `FileEditInput` declares `old_string` and `new_string` as required, so this is guaranteed by the SDK's own type rather than assumed. Codex never does, attaching no tool input at all, and falls back to path plus preview. A diff is never fabricated from one side.

- **CAP-6** — Tell attempts and loop iterations apart
  - **intent:** A reader can tell which attempt or loop iteration produced a given tool call.
  - **success:** A node whose rows span more than one `occurrence_id` renders a header per group; a single-occurrence node renders none. Grouping keys on `occurrence_id`, never on `attempt_id`, because one occurrence contains many attempts.

- **CAP-7** — Keep the raw payload reachable
  - **intent:** A developer debugging a provider can still read the exact bytes the provider sent.
  - **success:** Every card exposes a Raw toggle revealing the original JSON, closed by default. Today's `canLoadFullOutput` / `onLoadFullOutput` flow keeps working.

## Constraints

- Track A ships **no schema change, no migration, and no backend change**. Anything that would need new persisted data is out of scope by definition, not by preference — that is the line that keeps this retroactive.
- `@archon/web` must not import from `@archon/workflows`; wire types come from `api.generated.d.ts` through `lib/api.ts`.
- Console must not import from `@/components/`. Shared logic therefore lands in `packages/web/src/lib/` and the JSX is written twice, thin. Duplicating a little JSX for a surface scheduled for deletion beats refactoring code on its way out.
- **No raw `JSON.stringify` as a default presentation anywhere in the transcript.** It survives only behind CAP-7's explicit toggle. This is the defect being fixed; re-introducing it in a fallback path fails the spec.
- Status must be decodable **without colour** — a glyph character carries it, colour only reinforces. A coloured dot encodes state in hue alone and is lost to a colour-blind reader.
- A chip shows the tool name only when that name is **a single token of at most 24 characters**; otherwise it shows the **family name**. Codex sets the tool name to the entire shell command, so the fallback is a main path, not an edge case. The 24-character cap is the guard behind the rule, never the rule itself — read the other way round it becomes "truncate with an ellipsis", which is how three documents in the UX run came to teach a state this contract makes unreachable.
- Tool identification **duck-types over alias sets**; no name-keyed mapping table. One workflow run mixes three naming conventions in a single transcript (`superpower-feature.yaml` declares `omp`, `claude` and `codex` on different nodes), and a table would need a row per provider per tool.
- **Provider shape differences are normalized at the edge, never branched on in a renderer.** Where two providers disagree structurally — `todo` and `task` do, completely — a small normalizer in `lib/` converts each to one shared shape. `ToolPresentation` stays render-neutral and neither renderer learns a provider name. The same key can mean opposite things per provider (`path` is the pattern in OMP's `glob` and the search directory in Claude's), so a shared key is not evidence of a shared shape.
- Path headlines elide in the **middle**; commands and patterns elide at the end. A tail cut on a path destroys the only identifying part.
- Strict TypeScript, no unjustified `any`, ESLint at zero warnings. `bun run validate` is the pre-PR gate.
- Code comments and test names carry **no plan or section references** — no phase numbers, no `§` citations, no finding codes. Comments explain the invariant.

## Non-goals

- **Track B in full** — agent thinking, the triggering prompt, advisor notifications, and mid-turn steering. Those need persistence that does not exist and have their own prior contract at `../../../spec-workflow-run-view-hitl/`.
- **RunStream `ToolCallItem.tsx`** — its docblock states that always-visible input and output are a deliberate design choice, and it consumes a different type. Changing it reverses an explicit decision.
- **Chat `ToolCallCard.tsx`** — different data path, already has a usable card. The presenter's input type is structural so this can adopt it later without a rewrite.
- **Backend `workflows/src/utils/tool-formatter.ts`**, and the chat and Telegram output it feeds.
- **A run-level "Files changed" panel**, and node-level git attribution generally — the git routes are run-scoped, so "what did _this node_ change" is not answerable from git. Per-tool-call diffs (CAP-5) are the only node-level attribution available.

## Success signal

An operator opens a node from a run **already in the database** — no re-run, no migration — and reads what the agent did as a scannable list rather than a JSON dump.
The one failing `bash` call in a forty-call node is visible with its command and its exit code without a single click, and no JSON appears anywhere on screen unless the reader asks for it.

## Assumptions

- Both node rooms ship **together**, on the user's explicit and re-confirmed decision, even though Legacy is scheduled for deletion (`App.tsx:93-95`) and Console is already the default route (`App.tsx:75-76`). Deferring Legacy to a later slice was offered and declined. The cost this accepts, stated so nobody re-litigates it later: the render fork means a second JSX pass and a second renderer test suite for a surface with a finite life. Shared logic in `lib/` is written once regardless.
- Alias sets absorb provider **naming** drift, so no name-keyed mapping table is needed. They do **not** absorb semantic drift: the same key can carry a different meaning per provider, and two tools can share a name while having incompatible structures. Those cases are handled by the normalizers, not by aliases. Treating aliases as sufficient is what produced the `glob` and `output_mode` defects caught during specification.
- The production corpus is representative: **22,867 tool rows across 31 runs and 2,369 distinct tool names**, measured read-only against the deployment's own database. This replaced an earlier assumption built on 46 rows from a single research workflow, which turned out to cover none of the write-heavy traffic and to miss three tool families outright.

## Resolved during specification

Both questions this spec opened were settled from the published Claude Agent SDK 0.3.209 `sdk-tools.d.ts` — the exact version the lockfile pins — so no exploratory Claude run is needed.

- **The Agent SDK schemas match the harness schemas.** `FileEditInput {file_path, old_string, new_string, replace_all?}`, `FileReadInput {file_path}`, `FileWriteInput {file_path, content}`, `BashInput {command}`. The test plan may assert those key names directly.
- **`glob` earns its own family, but for the opposite reason to the one first recorded, and the difference cuts deeper than families.** Claude's `GlobInput` has a required `pattern` _and_ an optional `path` meaning the directory to search; OMP's `glob` has no `pattern` at all and its `path` **is** the pattern. Reading `path` as the headline would have shown Claude users their search directory instead of their pattern. Worse, `GrepInput.output_mode` defaults to `files_with_matches`, so Claude's grep returns **file paths, not `path:line` matches**, by default — the body arm must be chosen from `output_mode`, not from the family.
- **Chasing those two answers exposed two broken capabilities.** Claude's `TodoWrite` is a whole-list replacement with explicit statuses, no ops and no phases; Claude's `Agent` is a single dispatch, not OMP's batch. CAP-3 and CAP-4 were written against OMP's shapes alone. Both now normalize at the edge, per the constraint above.
