# Test plan

Coverage that decides whether each capability is met.
Pure modules get unit tests matching the existing `pair-tool-transcript.test.ts` and `merge-agent-room-items.test.ts`.
`bun run validate` is the pre-PR gate; do not run root `bun test`.

## Fixtures come from the SDK's own type declarations

No exploratory Claude run is needed: the published Agent SDK `sdk-tools.d.ts` for the pinned version declares every built-in tool's input shape, and the schemas match the harness.
Build the Claude half of each table from those declarations — `FileEditInput`, `FileReadInput`, `FileWriteInput`, `BashInput`, `GlobInput`, `GrepInput`, `TodoWriteInput`, `AgentInput` — and the OMP half from the real payloads in `findings.md`.
**Every table below must carry at least one Claude row and one OMP row**, because the two disagree on `glob`'s key meanings and on `todo` and `task` structurally; a single-provider table would pass while the other provider renders wrong.

## `tool-presentation.test.ts` — CAP-1, CAP-2, CAP-5

Table-driven over the resolver tiers.

- each Tier 1 alias resolves to the right family
- `file_path` **and** `path` both resolve; `old_string` **and** `old_str` both resolve
- **Claude glob** (`{pattern:'**/*.tsx', path:'packages/web'}`) headlines the **pattern** and sets scope to the path; **OMP glob** (`{path:'packages/web/src'}`) headlines the path with a null scope. Assert the Claude row does not headline `packages/web` — that is the exact regression this rule exists to stop
- grep body arm follows `output_mode`: `content` → `matches`, `files_with_matches` → `paths`, `count` → `generic`, **absent** → `matches`
- the five measured aliases resolve: `read_file` → file-read, `run_terminal_command` → shell, `search_replace` → **file-write** (not search), `search_tool` → search, `list_dir` → glob. The `search_replace` case is the substring-matching regression guard and must assert the family is `file`
- `target_file` resolves as a path key, alongside `file_path` and `path`
- `eval` with `{code, language}` resolves to family `code` with a `code` body; the headline is the source's first line and the language is a badge. Assert the source is **not** truncated to 80 characters — that truncation is what this family exists to avoid
- a Codex name containing newlines headlines only its **first non-empty line**, with the remainder reachable in the body. Assert the headline contains no `\n`
- a Codex name wrapped in `/bin/zsh -lc '…'` headlines the command **without** the prefix or the closing quote, and the same for `/bin/bash -lc '…'`. Assert the headline does not start with `/bin/`, and that the untouched name is still reachable for the terminal body
- chip text is the name **as sent**: `read_file` stays `read_file`, `Edit` stays `Edit`. Assert the chip is never the case-folded separator-stripped form — `readfile` appearing anywhere is the regression this asserts against
- Codex shape (`{name:'npm test'}`, no input) resolves to `shell` with headline `npm test`
- an emoji-bearing name passes through unchanged
- `mcp__server__tool` resolves to `generic` with label `server · tool`
- an unknown tool with object input renders at most three `key: value` pairs, **asserting the output contains no `{` and no `\n  "`** — the direct test that no JSON dump survives
- empty, null and array inputs never throw
- chip rule: a short name is kept verbatim; a long Codex-style name falls back to the family. **Assert `label.length <= 24` for every row in the table**, so no future tool can burst the chip
- `headlineKind` is `'path'` for the file and glob families, `'text'` for shell and content search
- a diff is produced only when both sides are present, and never fabricated from one
- the exit code reaches the row: a `bash` call recording `exit_code: 1` carries an `exit 1` badge on the **collapsed** row. This is CAP-1's own success signal and it is currently unreachable, the code discarding the value after deriving the outcome

## `diff-hunks.test.ts` — CAP-5

The module is the only caller of `structuredPatch`, so its traps are tested here rather than through a renderer.

- line numbers survive the `\ No newline at end of file` marker: a fixture whose hunk carries the marker **mid-array**, and one carrying it **twice**, both produce `oldLine`/`newLine` values matching a hand-checked expectation. Asserting only the trailing case passes while the counters are already desynchronised
- an input above the byte ceiling returns `null` without calling `structuredPatch`, and a pair exceeding `maxEditLength` returns `null` — both degrade to path plus preview, neither throws and neither hangs
- the same pair of strings yields the identical result on repeat calls, which is what an edit-length bound buys over a wall-clock timeout
- the produced `GitDiffHunk` feeds `git-hunk-adapter` without tripping its `requiredLine()` guard

## `task-normalize.test.ts` — CAP-4

- OMP's batch `{context, tasks:[a,b]}` yields two `TaskSubtask` entries and a rendered context block
- Claude's `{description, prompt, subagent_type}` yields exactly one entry, `name` from `description` and `agent` from `subagent_type`, with **no** context block
- a Claude dispatch omitting `subagent_type` yields `agent: null` and still renders

## `todo-state.test.ts` — CAP-3

Claude's shape first, because it is the one the OMP-shaped fold silently mishandles:

- Claude's `{todos:[…]}` folds last-call-wins into a single `"Tasks"` phase with statuses carried through verbatim
- three Claude calls in sequence produce only the third call's list, not a merge
- `activeForm` is dropped and never rendered

Then one case per OMP op, plus the three traps.

- bare `{"op":"done"}` completes **every** task in every phase; same for `drop`; bare `rm` clears all
- auto-promotion fires after every op — assert that a task the row never named changed status
- a row with **no** `op` is inferred (`list` → `init`, `items` plus `phase` → `append`), not discarded
- the legacy `{ops:[…]}` batch shape is accepted
- `block` does not reopen a `completed` task; `unblock` affects only `blocked`
- an unknown op leaves state unchanged; `done` before any `init` renders nothing
- `rm` that empties a phase drops the phase — assert no empty header survives, and that an all-empty fold returns `[]`
- the real two-phase fixture from the observed database rows reproduces the expected state

## Renderer tests — CAP-1, CAP-6, CAP-7

Extending `NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx`, on **both** surfaces.

- a successful tool call is collapsed by default; a failed one is expanded
- an `exit 1` badge appears when the exit code is non-zero
- a multi-occurrence node renders occurrence headers; a single-occurrence node renders none
- a long path headline elides in the middle — **assert the filename is still present**
- status is rendered as a glyph character, not colour alone. This is the accessibility guarantee and it is easy to regress in a restyle, so it gets its own assertion rather than riding along in a snapshot
- the Raw toggle is present and closed by default, and reveals the original payload when opened

## Boundary checks

- Console imports nothing from `@/components/` after the `git-hunk-adapter.ts` move — the existing console isolation test covers this and must stay green
- neither renderer imports `diff`; `structuredPatch` appears in exactly one module
- the moved `git-hunk-adapter.ts` imports its types from `api.generated`, not `@/lib/api` — the lint rule bans that path for Console including `import type`
- `@archon/web` imports nothing from `@archon/workflows`
