# Tool presentation contract

The machine contract behind CAP-1, CAP-2, CAP-4, CAP-5 and CAP-6.
One pure, React-free, provider-agnostic module produces a `ToolPresentation`; both renderers consume it and add only markup.

## Module

`packages/web/src/lib/tool-presentation.ts`.
Input is structural rather than tied to `AgentHistoryItem`, so the chat card can adopt it later without a rewrite.

```ts
import type { components } from './api.generated';
type GitDiffHunk = components['schemas']['GitDiffHunk']; // re-aliased, not a named export

export interface ToolPresentationInput {
  name: string;
  input: unknown;
  output: unknown;
}

export type ToolFamily =
  | 'shell'
  | 'file'
  | 'search'
  | 'glob'
  | 'code'
  | 'todo'
  | 'task'
  | 'web'
  | 'generic';

export interface ToolPresentation {
  family: ToolFamily;
  /** Chip text. The tool name AS SENT when it is a single token of <=24 chars, else the family name. */
  label: string;
  /** The single salient argument — command, path, pattern. Never JSON. */
  headline: string;
  /** 'path' elides in the MIDDLE so the filename survives; 'text' elides at the end. */
  headlineKind: 'path' | 'text';
  /** Collapsed-row secondary facts: '14 matches', '+12 −3', 'exit 1'. */
  badges: string[];
  body:
    | { kind: 'terminal'; command: string }
    | { kind: 'diff'; path: string; before: string; after: string; hunks: GitDiffHunk[] }
    | { kind: 'matches'; pattern: string; scope: string | null }
    | { kind: 'paths'; pattern: string; scope: string | null }
    | { kind: 'code'; language: string | null; source: string }
    | { kind: 'task'; context: string; subtasks: TaskSubtask[] }
    | { kind: 'generic'; fields: { key: string; value: string }[] };
}

export interface TaskSubtask {
  name: string;
  agent: string | null;
  prompt: string;
}

export function toolPresentation(input: ToolPresentationInput): ToolPresentation;
```

**There is no `todo` body arm.** Todo state spans calls and folds one level up, in `buildAgentHistory()` — see `todo-fold-contract.md`.

**`matches` and `paths` are two arms, not one.** Grep returns `path:line: text`; glob returns bare file paths, and a metacharacter-free `path` makes it a recursive directory listing whose output has no line numbers to parse. One arm would force the renderer to guess which it received.

## Resolver — four tiers, in order

No tier ever produces a JSON dump.

**Tier 1 — name match**, case-insensitive over alias sets.

Match on the **normalized** name: case-folded with `_` and `-` stripped, so `todo_write`, `TodoWrite` and `todowrite` are one token.

| Family           | Aliases (normalized)                                                                          | Corpus rows |
| ---------------- | --------------------------------------------------------------------------------------------- | ----------- |
| shell            | `bash` `shell` `run` `command` `execute` **`runterminalcommand`**                             | 4,766       |
| file (write)     | `edit` `write` `create` `strreplace` `applypatch` `notebookedit` **`searchreplace`** `delete` | 1,707       |
| file (read)      | `read` `view` `cat` `open` **`readfile`**                                                     | 7,159       |
| search (content) | `grep` `search` `rg` **`searchtool`**                                                         | 2,673       |
| glob (files)     | `glob` `find` `ls` `list` **`listdir`**                                                       | 242         |
| code             | **`eval`** `runcode` `execute code`                                                           | 821         |
| todo             | `todo` `todowrite` `plan`                                                                     | 198         |
| task             | `task` `agent` `subagent` `dispatch`                                                          | 46          |
| web              | `webfetch` `websearch` `fetch` `browse`                                                       | 6           |

The bolded aliases were **measured, not guessed**: without them 4,914 of 22,867 real rows — 21.5% — fell through to `generic`.
The five together recover 3,753 of those.
`find` and `ls` never fire on the observed corpus and stay as tolerant aliases; an alias that never fires costs nothing, a missing one costs a card.

**Match exact tokens, never substrings.** `search_replace` normalizes to `searchreplace`, which _contains_ `search` but is an **edit** tool — 904 rows would land in the wrong family under substring matching, rendering an edit as a search result.

An MCP name (`mcp__server__tool`) resolves to `generic` with label `server · tool`, following the existing convention in the backend formatter.

**Tier 2 — duck-type on input keys.** Used when Tier 1 misses, and to pick the headline _within_ a matched family. First hit wins.

| Signal       | Keys, in priority order                                                 |
| ------------ | ----------------------------------------------------------------------- |
| code         | `code` paired with `language`                                           |
| command      | `command` `cmd` `script`                                                |
| path         | `file_path` `path` `target_file` `file` `filename` `notebook_path`      |
| pattern      | `pattern` `query` `regex` `search`                                      |
| url          | `url` `uri`                                                             |
| before/after | `old_string`/`new_string`, `old_str`/`new_str`, `content`/`new_content` |

Claude's spelling is confirmed, so it leads each list.
The alternates stay because other providers genuinely use them and they cost nothing.

### `path` means opposite things in the two glob tools

This is the sharpest trap in the resolver, and a shared key name is what hides it.

|           | Claude `GlobInput`                     | OMP `glob`                          |
| --------- | -------------------------------------- | ----------------------------------- |
| `pattern` | **required** — the glob pattern        | does not exist; `strict` rejects it |
| `path`    | optional — the **directory to search** | **is** the pattern (default `"."`)  |

So for family `glob`: **headline is `pattern` when present, else `path`**; `scope` is `path` only when `pattern` is present, otherwise `null`.
`headlineKind` stays `'path'` for both — middle elision keeps both `packages/web/…` and a trailing `**/*.tsx`.
Reading `path` unconditionally would show a Claude user their search directory instead of their pattern.

A metacharacter-free `path` in OMP degrades to a recursive directory listing, which is the original reason this family is not a content search.

### The search body arm comes from `output_mode`, not from the family

`GrepInput.output_mode` is `"content" | "files_with_matches" | "count"` and **defaults to `files_with_matches`**.
So Claude's grep returns bare file paths unless the model asked for content.

| `output_mode`                  | body arm                                  |
| ------------------------------ | ----------------------------------------- |
| `content`                      | `matches` — parse `path:line`             |
| `files_with_matches` (default) | `paths` — a flat list, no line numbers    |
| `count`                        | `generic`; the count also becomes a badge |

A provider that sends no `output_mode` at all (OMP's `grep`) is treated as `content`, which is what it returns.
Choosing the arm from the family alone would mis-parse the majority of Claude's grep calls.

**Tier 3 — name-only.** When `input` is absent or empty, which is every Codex call: family `shell`, headline from the name.
This is 4,911 of 22,867 real rows, so it is a main path, not an edge case.

**Strip the Codex wrapper first.** The name arrives wrapped in a fixed `/bin/zsh -lc '` or `/bin/bash -lc '` prefix with a matching closing quote. Remove both **before** choosing the headline; the untouched name stays available for the terminal body and the Raw toggle. Without this the prefix is the first thing every Codex row shows, and the rule would otherwise exist only in `EXPERIENCE.md`, forcing each renderer to implement it for itself.

**The name is frequently multi-line.** Real rows carry whole shell scripts as the tool name — loops, `&&` chains, heredocs. A collapsed row is one line, so the headline is the **first non-empty line** of the stripped name, with a trailing `…` when more lines follow; the full text belongs to the terminal body.
Never feed the raw name into a single-line row.

Emoji-bearing names pass through unchanged; they are already human-readable.

The `code` family headlines the **first non-empty line of the source**, `headlineKind: 'text'`, with the language as a badge.
The 80-character generic truncation is exactly why this family exists: `eval` carries whole programs, and the fallback would have shown a stub.

**Tier 4 — generic.** Up to three scalar top-level entries as `key: value`, each value truncated to 80 characters.
Objects and arrays collapse to `{…}` / `[n]`, never expanded inline.
With no scalar entry, the headline is the tool name alone.

## Collapsed row

```
▸   ✓    [read]   console/primitives/event.ts        237 lines · 120ms
▾   ✕    [bash]   bun test node-room                   exit 1 · 2.4s
chev glyph chip    headline (flex, min-width:0)        badges (right)
```

**Status glyph `✓ ✕ ◐ ⚠ –`**, mapped from the existing `AgentHistoryItem.outcome` via `deriveOutcome()`, reused unchanged.
Five characters for the five values that type carries (`agent-history.ts:36`). `⚠` is `interrupted` — a tool that was **stopped**, not one that failed, so it takes its own character rather than a recoloured `✕`. Only Claude produces it, from the `PostToolUseFailure` hook when `is_interrupt` is true (`claude/provider.ts:952-959`); Codex cannot, its union being `success`/`error`/`unknown` (`codex/provider.ts:644-650`).
Colour is applied _in addition to_ the glyph, never instead of it.

**Chip** is the tool name **as the provider sent it** — `read_file`, `Edit`, `Grep`, `eval` — when that name is a single token of at most 24 characters, else the family name.
Normalisation (case-folding, stripping `_` and `-`) is a **matching** device for the resolver only, never a display transform: a chip reading `readfile` would contradict every example in the UX run.
The family-name fallback is unchanged and is the rule; the 24-character cap is its guard, never an instruction to truncate with an ellipsis.
Codex is the case the fallback exists for: the name is the whole command, so the chip reads `shell` and the command becomes the headline.
`label` is resolved in the module, so renderers never re-derive it.

**Headline elision** is middle-out for `headlineKind: 'path'` and end-cut otherwise.
The headline element needs `min-width: 0` inside the flex row or it will not shrink.

**Badges** are right-aligned and never wrap: duration, exit code, match count, `+n −m`, plus the existing truncation markers (`truncated`, `output missing`, `output unknown`), preserved as-is.

## Expanded body

| Family  | Rendering                                                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shell   | terminal block, `$ command` header, output preformatted; exit-code badge                                                                                              |
| file    | diff when before/after are present, else path plus preview                                                                                                            |
| search  | pattern and scope, then results as a list; `path:line` lines become items                                                                                             |
| glob    | the pattern or listed directory, then output as a flat list of file paths — no `path:line` parsing, because there are no line numbers to parse                        |
| code    | the source as a highlighted block, language from the payload; result below it. Uses the `highlight.js` and `rehype-highlight` already in the tree — no new dependency |
| todo    | folded checklist, from accumulated state rather than this call                                                                                                        |
| task    | `context` as markdown, then one collapsible card per subtask                                                                                                          |
| web     | url and title, output as markdown                                                                                                                                     |
| generic | `key: value` list; output as markdown if it parses as text, else preformatted                                                                                         |

## Inline diff

`packages/web` has **no** line-diff algorithm. The existing adapter at `packages/web/src/components/workflows/source-control/git-hunk-adapter.ts` (57 lines) only **converts** an already-computed `GitDiffHunk` — one the server's git routes produced — into `react-diff-view`'s shape. It computes nothing, and no differ is among the package's declared dependencies.

So CAP-5 needs two modules, not one.

**`diff` (jsdiff) `9.0.0` is declared as a dependency of `@archon/web`**, and a new `packages/web/src/lib/diff-hunks.ts` is the **only** caller of `structuredPatch` in the tree — options fixed inside it, results memoized on the two input strings. Neither renderer imports `diff`.

`StructuredPatchHunk` is `{oldStart, oldLines, newStart, newLines, lines: string[]}` with prefix-encoded lines, so the module walks `lines` with running old/new counters and synthesises the `@@ -a,b +c,d @@` header to produce `GitDiffHunk`. Two details it must not miss:

- **Bounds are mandatory.** jsdiff ships no default timeout and no default edit-length limit, and an unbounded synchronous Myers diff **hangs the thread** rather than failing. The module refuses inputs above a byte ceiling and passes an explicit `maxEditLength`; both answers are `null`, degrading to path plus preview. The bound is `maxEditLength`, never a wall-clock timeout — an edit-length bound is a function of the inputs, so the same pair yields the same result on every machine and in every test run.
- **The no-newline marker is not trailing.** A line beginning with `\` is skipped **wherever it appears and however often**, advancing no counter: real jsdiff 9 output places it mid-array and can emit it twice in one hunk, and it is excluded from `oldLines`/`newLines`. Treating it as one trailing line desynchronises every counter after it.

**The existing adapter then runs unchanged, and moves to `packages/web/src/lib/`** so Console can import it without crossing the `@/components/` boundary. It re-aliases `GitDiffHunk`/`GitDiffChange` from `api.generated` rather than `@/lib/api`, which the Console lint rule bans outright — including for `import type`. Its two consumers, `virtualized-diff.tsx` and its test, update their import path.

Claude always qualifies.
Codex never does — no tool input at all — so it falls back to path plus preview.

## Occurrence grouping

Group rows by `occurrence_id`, label from `retry_epoch` and `loop_ancestry`, and render a header only when a node has more than one group.
Never group or label by `attempt_id`: `mintTranscriptExecutionScope()` mints a new occurrence _and_ attempt, while `newTranscriptAttempt()` reuses the occurrence, so one occurrence contains many attempts and a UI group called "Attempt" keyed on `attempt_id` would mean something finer than the label claims.

## Provider normalizers

Two tools disagree **structurally** between providers, not just in key spelling.
Each gets a small normalizer in `lib/` that converts the provider payload to one shared shape, so `ToolPresentation` stays render-neutral and neither renderer ever learns a provider name.

### `task` → `TaskSubtask[]`

|               | OMP                                           | Claude `AgentInput`                                                                       |
| ------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| shape         | `{ context, tasks: [{ name, agent, task }] }` | `{ description, prompt, subagent_type?, model? }`                                         |
| dispatches    | a batch                                       | exactly one                                                                               |
| normalizes to | one entry per `tasks[]` element               | one entry: `name` = `description`, `agent` = `subagent_type ?? null`, `prompt` = `prompt` |

The batch `context` block renders only when the provider sends one; Claude has no batch level, so its card is the subtask alone.

### `todo` → `TodoPhase[]`

See `todo-fold-contract.md`. OMP folds nine ops; Claude's whole-list `TodoWrite` is a degenerate fold where the last call wins.

## Changes to the existing shared layer

`buildAgentHistory()` **returns** an object carrying `items` plus the node's `TodoPhase[]`. A flat per-item array cannot hold node-level state, so the return type widens and its three call sites take a one-line edit each — `ConsoleNodeRoom.tsx:607`, `ConsoleExecutionHistory.tsx:204`, `NodeTranscriptPane.tsx:236`.

Each tool item gains the presentation.
`TOOL_CONTEXT_KEYS` and `toolContext()` are superseded by the resolver and go away; their only readers are `NodeRoom.tsx:246` and `ConsoleAgentHistoryList.tsx:178`, both JSX this work rewrites.

**The exit code must reach the item.** It is parsed at `agent-history.ts:115` and consumed at `:126` only to decide `failed`, then discarded — so today CAP-1's own success signal, the failing `bash` call showing its exit code with no click, is unimplementable. Carry it through to the badges.

No renderer reads execution identity today, so occurrence grouping is new plumbing through the same layer.
