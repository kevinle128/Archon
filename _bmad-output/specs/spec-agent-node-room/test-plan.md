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
- grep body arm follows `output_mode`: `content` → `matches`, `files_with_matches` → `paths`, `count` → `generic` (search family retained). Absent `output_mode` and any declared output mode, the **sent alias** decides: exact `Grep` → `paths` (the SDK `files_with_matches` default); lowercase `grep` and other search aliases → `matches` (content)
- the five measured aliases resolve: `read_file` → file-read, `run_terminal_command` → shell, `search_replace` → **file-write** (not search), `search_tool` → search, `list_dir` → glob. The `search_replace` case is the substring-matching regression guard and must assert the family is `file`
- `target_file` resolves as a path key, alongside `file_path` and `path`
- `eval` with `{code, language}` resolves to family `code` with a `code` body; the headline is the source's first line and the language is a badge. Assert the source is **not** truncated to 80 characters — that truncation is what this family exists to avoid
- a Codex name containing newlines headlines only its **first non-empty line**, with the remainder reachable in the body. Assert the headline contains no `\n`
- a Codex name wrapped in `/bin/zsh -lc '…'` headlines the command **without** the prefix or the closing quote, and the same for `/bin/bash -lc '…'`. Assert the headline does not start with `/bin/`, and that the untouched name is still reachable for the terminal body
- chip text is the name **as sent**: `read_file` stays `read_file`, `Edit` stays `Edit`. Assert the chip is never the case-folded separator-stripped form — `readfile` appearing anywhere is the regression this asserts against
- Codex shape (`{name:'npm test'}`, no input) resolves to `shell` with headline `npm test`
- an emoji-bearing name passes through unchanged
- `mcp__server__tool` resolves to `generic` with label `server · tool`
- an unknown tool with object input renders at most three `key: value` pairs, **asserting no field carries serialized object syntax or quoted JSON keys (`"`/`": "`/`: {`) while the required `{…}` and `[n]` markers still appear** — the direct test that no JSON dump survives
- empty, null and array inputs never throw
- chip rule: a short name is kept verbatim; a long Codex-style name falls back to the family. **Assert `label.length <= 24` for every row in the table**, so no future tool can burst the chip
- `headlineKind` is `'path'` for the file and glob families, `'text'` for shell and content search
- a diff is produced only when both sides are present as own-property strings on a `file`-family row, and never fabricated from one — the canonical pair and both aliases qualify (empty strings included), while inherited/prototype keys, throwing accessors, one-sided pairs, wrong types, absent input, and alias-shaped keys on non-file families do not
- a nonempty diff emits `+n` (success) and `−m` (danger) collapsed badges — each only when its side is positive — and body facts `N hunk`/`N hunks` then `replace_all: true|false` only for an own boolean input; the body bar composes `file · 1 hunk · replace_all: false` and never repeats the `+n −m` badges
- an identical pair reports `no changes` with no badges; a refused pair keeps the preview fallback with no facts
- repeated summary and body calls on the same record read the pair once (the record `WeakMap`), and a second record with equal strings reuses the identical pair-cache result object
- the exit code reaches the row: a `bash` call recording `exit_code: 1` carries an `exit 1` badge on the **collapsed** row. This is CAP-1's own success signal and it is currently unreachable, the code discarding the value after deriving the outcome
- hostile and oversized outputs stay within the contract ceilings: nested `file_matches` and web-result arrays report their hidden tail, grep path/text values and generic field keys are independently bounded and sanitized, over-cap text ends in an ellipsis without exceeding its ceiling, and assembled web markdown cannot exceed the text ceiling
- inherited enumerable properties are never emitted and count toward the finite key-scan budget, so a hostile prototype cannot force an unbounded scan

CAP-5 scope is presentation over persisted rows — the resolved product gate: current Codex `file_change` events are emitted as `system` chunks (`codex/provider.ts:709`) that the executor debug-logs (`dag.system_message_unhandled`) rather than persisting, so they never become file rows and no fixture row is a Codex row. A no-input fake-provider row exercises the same fallback as **generic defensive coverage only**; tests, reports, and docs label it that way and never read it as Codex behavior.

## Generic-fallback corpus audit — CAP-2 / Story 1.3 (the < 2% bound)

The < 2% generic-fallback bound is measured against the deployment corpus (22,867 rows, 2,369 distinct names), **not** reproducible from a CI fixture. So it is a **release-time deployment audit**, not a unit test:

- a **read-only replay script** (`scripts/audit-generic-fallback.ts`) queries the deployment DB for projected tool rows, runs the pairing + resolver over them, and reports the generic-fallback **numerator** (logical cards resolving to `generic`) and **denominator**, plus the fraction
- the script records its result to a known location (the release audit log) with the corpus snapshot date; the release gate reads the recorded fraction and fails release if it is ≥ 2%
- `--source` and optional generic-name diagnostics accept identifier-safe values only; record checking rejects unknown fields and non-canonical timestamps, and `--record` refuses to target the SQLite corpus itself before opening either path
- group projection is streaming and keeps only the current group, rejecting non-monotonic input instead of retaining a set of every prior group; threshold comparison uses exact integer arithmetic
- **denominator decision — adopted `logical-tool-cards-v1` (2026-09-18):** this section historically read "total rows" (raw storage rows), but paired call/result storage means raw rows double-count modern calls. The PRD's headless coordination-gate clause authorizes adopting the plan's recommended decision when no owner-ratified alternative exists — none was found — so the denominator is one **logical UI tool card per invocation**, projected through `projectToolTranscript()` per `(workflow_run_id, node_id)` group: pending call-only cards and legacy result-only cards each count once; text/status rows never enter the denominator. Only this metric is implemented. Evidence: `plans/260918-0834-issue-176-tool-family-bodies/reports/us-005-audit-decision.md`
- **no numerator/denominator is frozen in this document** — the corpus is live data; the number is produced by the replay, not asserted here
- the table-driven alias cases above stay as CI regression tests for named aliases (they cannot prove the corpus-wide bound)

## `diff-hunks.test.ts` — CAP-5

The module is the only caller of `structuredPatch`, so its traps are tested here rather than through a renderer. Tests drive a `createDiffHunks` factory with injected `patch`/`byteLength`/memo budgets — the exported `diffHunks` singleton carries no test seams.

- line numbers survive the `\ No newline at end of file` marker: a fixture whose hunk carries the marker **mid-array**, and one carrying it **twice**, both produce `oldLine`/`newLine` values matching a hand-checked expectation. Asserting only the trailing case passes while the counters are already desynchronised
- an input above the byte ceiling returns `null` without calling `structuredPatch` — including a multibyte string that passes the code-unit `.length` precheck but fails the UTF-8 measurement — and a pair exceeding `maxEditLength` returns `null` (a real 1,001/1,000 disjoint-edit fixture plus an injected `undefined`), as does a thrown patch; both degrade to path plus preview, neither throws and neither hangs. Refusals are cached, but the uncached `.length` precheck never stores an oversized pair
- the line cap is exact: 2,000 logical lines accepted, 2,001 refused without `patch`, including the no-trailing-newline off-by-one
- the same pair of strings yields the identical result object on repeat calls, which is what an edit-length bound buys over a wall-clock timeout; a cache hit refreshes LRU order, and count eviction plus source-weight eviction each recompute only the evicted pair
- empty-to-content, deletion-to-empty, identical sides (`{ hunks: [] }`), repeated content, and CRLF-vs-LF pairs (raw-compared, so a line-ending rewrite shows changed rows with equal visible text) all produce deterministic results
- ANSI escapes, C0/C1 controls, bidi overrides/isolates, zero-width format controls, BOM, and `U+2028`/`U+2029` cannot create hidden, reordered, or fake display lines — `Cf` and the two separators become visible `\u{HEX}` text and every emitted line stays within 1,024 code units, ellipsis included
- the produced `GitDiffHunk` feeds `git-hunk-adapter` without tripping its `requiredLine()` guard — every emitted line number is positive and snippet-relative to its hunk's `oldStart`/`newStart`

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
- an `interrupted` status row folds into the **preceding** tool call so it shows `⚠ interrupted`, not `✕ failed` — asserted on a non-Claude fixture; this is the cross-provider reader fold the write half depends on, tested here in the read half where the fold lives

## Boundary checks

- Console imports nothing from `@/components/` after the `git-hunk-adapter.ts` move — the existing console isolation test covers this and must stay green
- neither renderer imports `diff`; `structuredPatch` appears in exactly one module
- the moved `git-hunk-adapter.ts` imports its types from `api.generated`, not `@/lib/api` — the lint rule bans that path for Console including `import type`
- `@archon/web` imports nothing from `@archon/workflows`
