---
phase: 1
title: 'Phase 1: Shared body contract and output normalizer'
status: pending
priority: P1
effort: '1.5d'
dependencies: []
---

# Phase 1: Shared body contract and output normalizer

## Goal

Add a `body` to `ToolPresentation` for all nine families, backed by a pure, bounded, React-free output normalizer that turns every persisted output string — Claude, OMP, Devin, Codex, Grok — into text, a list, scalar fields, or an explicit unreadable state, with red-first table tests carrying Claude, OMP and Devin rows.

## Context links

- Story AC: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:261-288`
- Contract: `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md:6-52` (shape), `:65-151` (tiers), `:176-189` (body table)
- Test plan: `_bmad-output/specs/spec-agent-node-room/test-plan.md:12-36`
- Shipped presenter: `packages/web/src/lib/tool-presentation.ts` (resolution `:419-503`, row composition `:538-595`)
- Provider serializers: `packages/providers/src/claude/provider.ts:917-926`, `packages/providers/src/community/omp/event-parser.ts:37-44`, `packages/providers/src/community/devin/event-bridge.ts:51-61`, `packages/providers/src/codex/provider.ts:642-659`, `packages/providers/src/grok/event-parser.ts:22-29`

## Key insights

- Output is always a string at rest; the family never depends on it. The normalizer is provider-agnostic by **key rules over a parsed object**, so the lib never branches on a provider name.
- 7.3% of JSON-looking outputs are truncated at rest and unparseable, with no full-output recovery. Salvaging the cut string literal is the only honest presentation short of Raw.
- Claude `Grep`/`Glob`/`WebFetch`/`WebSearch` output shapes have zero local rows. Capture them first; do not write them into code from memory.

## Requirements

- [ ] `ToolPresentation.body` exists for every resolved presentation, including the safe fallback path (`safePresentation`, `tool-presentation.ts:506-520`).
- [ ] No body arm and no normalizer output ever contains serialized JSON text; an unrecognized object degrades to ≤3 scalar `key: value` pairs.
- [ ] Every algorithm is bounded by an exported `MAX_*` constant and terminates on adversarial input (deep objects, huge strings, byte arrays, unterminated literals).
- [ ] Family resolution stays name-plus-input only; output never reclassifies a family (audit invariant).
- [ ] Each test table has at least one Claude row and one OMP row, plus a Devin row where the shape differs (`test-plan.md:11`).

## Architecture

### `packages/web/src/lib/tool-output.ts` (new)

```ts
export const MAX_OUTPUT_PARSE_CODE_UNITS = 65_536;  // JSON.parse attempted only under this
export const MAX_OUTPUT_TEXT_CODE_UNITS = 65_536;   // displayed text head-sliced beyond this, '…' appended
export const MAX_OUTPUT_LIST_ITEMS = 500;           // matches/paths items kept; the rest is `overflow`
export const MAX_OUTPUT_BYTE_ARRAY = 65_536;        // Devin byte arrays decoded only under this length
export const MAX_OUTPUT_FIELDS = 3;                 // reuse of the generic cap (MAX_GENERIC_FACTS)

export type NormalizedOutput =
  | { kind: 'text'; text: string; salvaged: boolean }
  | { kind: 'list'; items: string[]; overflow: number }
  | { kind: 'fields'; fields: { key: string; value: string }[]; counts: { matches: number | null; files: number | null } }
  | { kind: 'unreadable' }   // JSON-looking, unparseable, and no literal was cut
  | { kind: 'empty' };       // undefined / null / ''

export function normalizeToolOutput(output: unknown): NormalizedOutput;
export function stripAnsi(text: string): string;                    // SGR/CSI only, bounded by text cap
export function splitLines(text: string, max: number): { lines: string[]; overflow: number };
```

Key rules over a parsed object, first hit wins (the order is the contract; each rule has a fixture row):

| # | Rule                                                                     | Observed source                     |
| - | ------------------------------------------------------------------------ | ----------------------------------- |
| 1 | `content: [{ type: 'text', text }]` → join texts with `\n`               | OMP `read`/`grep`, MCP results      |
| 2 | `stdout` string (+ `\n\n` + `stderr` when non-empty)                     | Claude `Bash`                       |
| 3 | `file.content` string                                                    | Claude `Read`                       |
| 4 | `type: 'create'` with `content` string                                   | Claude `Write`                      |
| 5 | `filenames: string[]` → list                                             | Claude `Glob`, `Grep` files mode `[UNVERIFIED]` |
| 6 | `mode: 'content'` / `'count'` with `content` string → text               | Claude `Grep` `[UNVERIFIED]`        |
| 7 | `FileContent.content` / `Content.content` string                         | Devin `read_file`, `list_dir`       |
| 8 | `output: number[]` → `TextDecoder` over `Uint8Array` (length-capped)     | Devin `run_terminal_command`        |
| 9 | `result` string                                                          | Claude `WebFetch` `[UNVERIFIED]`    |
| 10| first string among `text`, `output`, `message`                           | tolerant tail                       |
| 11| otherwise → `fields` (≤3 scalars, `{…}` / `[n]`), with `counts` read from `count` / `numMatches` / `numLines` / `numFiles` | Claude `Edit`, Devin `SearchReplace`, `StructuredOutput` |

A plain string that does not start with `{`/`[` is `text` as-is (ANSI-stripped, capped). A string that starts with `{`/`[` and fails to parse goes to the salvage scanner: walk the string tracking `"…"` literals and escapes; if the input ends **inside** a literal, decode that literal's content (escapes resolved, bounded) and return `text` with `salvaged: true`; otherwise `unreadable`. A trailing hook marker `...` or transport marker `… [truncated …` stays inside the salvaged text (it is informative and the `truncated` badge already says so).

### `packages/web/src/lib/tool-presentation.ts` (modify)

```ts
export interface MatchItem { path: string | null; line: number | null; text: string }

export type ToolBody =
  | { kind: 'terminal'; command: string; output: string | null; unreadable: boolean }
  | { kind: 'file'; path: string; preview: string | null; unreadable: boolean }
  | { kind: 'matches'; pattern: string; scope: string | null; items: MatchItem[]; overflow: number }
  | { kind: 'paths'; pattern: string; scope: string | null; items: string[]; overflow: number }
  | { kind: 'code'; language: string | null; source: string; result: string | null }
  | { kind: 'web'; url: string; title: string | null; markdown: string | null }
  | { kind: 'generic'; fields: { key: string; value: string }[]; output: { kind: 'markdown'; text: string } | { kind: 'fields'; fields: { key: string; value: string }[] } | null };

export interface ToolPresentation { …existing…; body: ToolBody }
```

Per-family body resolution (inside `resolveToolPresentation`, after the headline switch):

| Family  | Body                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| shell   | `terminal`: `command` = input `command`/`cmd`/`script` (full, multi-line) else the **untouched** name (wrapper kept, per EXPERIENCE `:114`); `output` = normalized text (list → joined lines; fields → null) |
| file    | `file`: `path` = headline source; `preview` = normalized text → input `content` → input after-string (`new_string`/`new_str`/`new_content`) → null   |
| search  | arm by `input.output_mode` → parsed output `mode` → `matches`. `matches`: items from lines `^([^:\n]+):(\d+)[:-](.*)$`, else `{path:null,line:null,text}`; `paths`: list items or non-empty lines. `count` → `generic` with the count as a badge. `scope` = input `path` |
| glob    | `paths`: `pattern` = input `pattern` else `path` (the 1.1 rule), `scope` = `path` only when `pattern` present; items = list or non-empty lines (Devin `ListDir` yields indented `- name` lines — bounded and honest) |
| code    | `code`: `source` = input `code` (untruncated), `language` = input `language`, `result` = normalized text or null                                       |
| web     | `web`: `url` = input url key; `title` = top-level string `title` in parsed output else null; `markdown` = normalized text                            |
| todo, task, generic | `generic`: `fields` = ≤3 scalar pairs from input (objects `{…}`, arrays `[n]` — extend `genericFacts` to emit these markers); `output` = text → markdown, fields → fields, else null |

Count badge: replace the raw-output `countBadge(input.output)` (`:460`) with counts from the normalized output — `N matches` on the matches arm, `N files` on the paths arm — keeping the OMP `count` key and digit-only string cases green.

MCP-named tools keep `family: 'generic'` and now carry a `generic` body. `safePresentation` returns `body: { kind: 'generic', fields: [], output: null }`.

## Related code files

- Create: `packages/web/src/lib/tool-output.ts`, `packages/web/src/lib/tool-output.test.ts`
- Modify: `packages/web/src/lib/tool-presentation.ts`, `packages/web/src/lib/tool-presentation.test.ts`
- Modify: `packages/web/src/experiments/console/console-isolation.test.ts:114-126` (add `@/lib/tool-output` to `approved` — Phase 2 imports it)
- Read only: `packages/web/src/lib/agent-history.ts:157-192` (no change; presentation already flows)

## File inventory

| File                                                            | Action | Size   | Test impact                                             |
| --------------------------------------------------------------- | ------ | ------ | ------------------------------------------------------- |
| `packages/web/src/lib/tool-output.ts`                           | create | ~250 L | new `tool-output.test.ts`                               |
| `packages/web/src/lib/tool-output.test.ts`                      | create | ~300 L | —                                                       |
| `packages/web/src/lib/tool-presentation.ts`                     | modify | +150 L | existing 141 tests must stay green; new body tables     |
| `packages/web/src/lib/tool-presentation.test.ts`                | modify | +250 L | —                                                       |
| `packages/web/src/experiments/console/console-isolation.test.ts`| modify | +1 L   | isolation test stays green after Phase 2 import          |
| `packages/web/src/lib/__fixtures__/tool-output/*.json` (optional) | create | small | captured Claude payloads used by both test files        |

## Implementation steps

1. **Capture the unverified Claude shapes.** Run one throwaway workflow node on `provider: claude` (a temporary YAML under the worktree's `.archon/workflows/`, never committed) whose prompt calls `Grep` with `output_mode: content`, `Grep` with the default mode, `Grep` with `output_mode: count`, `Glob`, `WebFetch`, and `WebSearch`. Read the result rows back with `sqlite3 -readonly` from `remote_agent_workflow_node_messages` and copy the `output` strings into fixtures. Replace every `[UNVERIFIED]` tag in this file and in `plan.md` with the observed shape; if a shape differs from rules 5/6/9, adjust the rule table **before** writing code.
2. **Tests before (red).** Write `tool-output.test.ts` tables and the new `tool-presentation.test.ts` body tables listed under Test scenario matrix. Run `bun test src/lib/tool-output.test.ts src/lib/tool-presentation.test.ts` from `packages/web` and confirm the new cases fail for the right reason (missing module / missing `body`).
3. **Implement `tool-output.ts`**: parse guard, rule table, byte-array decode, salvage scanner, `stripAnsi`, `splitLines`, bounds. Each helper stops scanning at its cap; no recursion into nested objects beyond the named paths.
4. **Extend `tool-presentation.ts`**: add `MatchItem`/`ToolBody`, resolve bodies per family, route the count badge through the normalized output, extend `genericFacts` to emit `{…}` / `[n]` for object/array values, give `safePresentation` a body, and rewrite the `ToolPresentation` docblock (`:59`) to describe the contract without story references.
5. **Refactor under protection**: keep every existing 1.1 assertion green (chip, headline, badges order, adversarial inputs). Where the new count behaviour changes an existing expectation, update the test with the reason in the test name (behaviour, not story id).
6. **Add `@/lib/tool-output`** to the Console isolation `approved` set.
7. **Regression gate**: `bun --filter @archon/web test`, then `bun run type-check` and `bun run lint --max-warnings 0`.

## Test scenario matrix

| Path       | Scenario                                                                                                             | Provider rows          |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Critical   | Claude `Bash` output `{"stdout":"a","stderr":"","interrupted":false}` → terminal output `a`, contains no `{`         | Claude                 |
| Critical   | OMP `exec` plain text with `[31m` → terminal output stripped of SGR; OMP `grep` content blocks → joined text  | OMP                    |
| Critical   | Devin `{"type":"Bash","output":[104,105]}` → terminal output `hi`; array over `MAX_OUTPUT_BYTE_ARRAY` → unreadable  | Devin                  |
| Critical   | Codex `{ name: "/bin/zsh -lc 'bun test'" }` no input, output `…\n[exit code: 1]` → `command` keeps wrapper, output text verbatim | Codex          |
| Critical   | Truncated `{"stdout":"abc\ndef...` (no closing) → salvaged text `abc\ndef...`, `salvaged: true`; `{"a":1,` → unreadable | Claude               |
| Critical   | Grep arm: `output_mode: content` → matches; `files_with_matches` → paths; `count` → generic + count badge; absent → matches (OMP) | Claude + OMP  |
| Critical   | Unknown tool with object input and object output → body fields ≤3, contains no `{` and no `\n  "`; nested object → `{…}`, array → `[3]` | any |
| Critical   | Every table row: `body` defined; family unchanged when `output` is swapped for `undefined` (audit invariant)         | all                    |
| High       | Claude `Read` `{"type":"text","file":{"content":"x"}}` → file preview `x`; Claude `Write` `{"type":"create",…}` → content | Claude              |
| High       | Claude `Edit` output object (no text key) → preview falls back to input `new_string`; OMP `edit` empty output → preview from `new_str`/`content` | Claude + OMP |
| High       | Claude glob `{pattern:'**/*.tsx', path:'packages/web'}` + `{"filenames":[…]}` → paths items, scope `packages/web`; OMP glob `{path:'src'}` + numbered text → items are lines, scope null | Claude + OMP |
| High       | Devin `list_dir` indented tree → paths items are the non-empty lines (documented, bounded)                            | Devin                  |
| High       | `eval` `{code, language:'python'}` + result text → code body, `source` untruncated (> 80 chars asserted), `result` set | OMP-style             |
| High       | Web `{url}` + `{"result":"# Title\n…"}` → web body markdown; title null unless top-level `title` string               | Claude `[UNVERIFIED]`  |
| High       | Matches parse: `src/a.ts:12:const x` → `{path:'src/a.ts', line:12, text:'const x'}`; `--` separator line → path null | any                    |
| Medium     | 501 output lines → 500 items + `overflow: 1`; text over `MAX_OUTPUT_TEXT_CODE_UNITS` → head slice + `…`              | any                    |
| Medium     | Output `undefined`/`null`/`''` → `empty`; body output null; body never throws on array/number/boolean output          | any                    |
| Medium     | Todo `{op:'done', task:'x'}` and Claude `{todos:[…]}` → generic body fields (`todos: [3]`), headline still `todo updated` | Claude + OMP        |
| Medium     | Task OMP `{context, tasks:[…]}` and Claude `{description, prompt}` → generic body fields, prompt truncated at 80      | Claude + OMP           |
| Medium     | MCP `mcp__server__tool` → generic body, label unchanged                                                              | any                    |

## Tests before

- `tool-output.test.ts`: rule table (one `test.each` row per rule with the observed fixture string), salvage cases, byte-array decode + cap, ANSI strip, `splitLines` overflow, empty/non-string inputs.
- `tool-presentation.test.ts`: new `describe('body arms')` tables per family, `describe('grep arm precedence')`, `describe('no serialized data in bodies')`, `describe('output never reclassifies family')`.

## Refactor

- `countBadge` → reads `NormalizedOutput.counts` and list length; existing OMP `count` key and digit-only string cases keep passing.
- `genericFacts` → emits `{…}` for objects and `[n]` for arrays instead of skipping them (collapsed rows are unaffected because the headline still joins scalar facts only — add an assertion that the collapsed headline contains no `{…}`).
- `ToolPresentation` docblock rewritten; `safePresentation` carries a body.

## Tests after

- Bodies present on every family; the four-tier resolution tests from 1.1 unchanged and green.
- `console-isolation.test.ts` green with the new approved module.

## Regression gate

```bash
cd packages/web && bun test src/lib/tool-output.test.ts src/lib/tool-presentation.test.ts
bun --filter @archon/web test
bun run type-check && bun run lint --max-warnings 0 && bun run format:check
```

## Dependency map

- Blocks Phase 2 (renderers consume `presentation.body`) and Phase 3 (the audit imports `toolPresentation`).
- Depends on nothing in this plan. Depends on Story 1.1 (shipped, `0fb1fd04`).
- Coordinates with Story 1.2: no file in this phase is touched by 1.2 except `tool-presentation.ts` (1.2 adds `toolRawPayloadJson`); additive on both sides, merge is trivial.

## Todo

- [ ] Capture Claude `Grep`/`Glob`/`WebFetch`/`WebSearch` outputs and replace `[UNVERIFIED]` tags
- [ ] Red tables in `tool-output.test.ts` and `tool-presentation.test.ts`
- [ ] Implement `tool-output.ts` with bounds and salvage
- [ ] Add `ToolBody` and per-family body resolution; route count badge through parsed output
- [ ] Rewrite `ToolPresentation` docblock; give `safePresentation` a body
- [ ] Add `@/lib/tool-output` to the Console isolation allowlist
- [ ] Regression gate green

## Success criteria

- All new tables green; all 1.1 tests green; `type-check`, `lint`, `format:check` green.
- Replaying the local corpus with `output: undefined` still yields 20/1,966 generic (family invariant held).
- No `[UNVERIFIED]` tag remains in the plan.

## Risk assessment

| Risk                                                                                  | Signal                                             | Response                                                                                |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Captured Claude `Grep`/`WebFetch` shapes differ from rules 5/6/9                      | Step 1 fixture disagrees with the rule table       | Adjust the rule table and fixtures before coding; do not special-case by tool name      |
| Salvage scanner mis-decodes an escape at the cut                                      | Test with a cut inside `\u00` or `\n`              | Treat an incomplete escape as end of text; assert no throw                              |
| Count badge change alters an existing 1.1 assertion                                   | Existing `count fact` tests fail                   | Keep OMP `count` and digit-only semantics; update only the raw-JSON-string expectation  |
| `TextDecoder` unavailable in the bun test runtime                                     | ReferenceError in tests                            | It is a bun global; if absent, decode via `String.fromCharCode` over the capped array   |

## Security considerations

- The normalizer renders text through React text nodes only; no HTML is produced here. Fixtures must not contain real tokens or personal data (scrub captured payloads before committing).
- Byte-array decode and JSON parse are length-capped so a hostile payload cannot stall the render thread.
