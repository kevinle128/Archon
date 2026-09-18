---
phase: 1
title: 'Phase 1: Shared normalizer and lazy body contract'
status: pending
priority: P1
effort: '1.5d'
dependencies: []
---

# Phase 1: Shared normalizer and lazy body contract

## Goal

Create a pure, React-free, provider-agnostic output normalizer and a lazy family-body resolver. Preserve the existing four-tier summary resolver and prove that output cannot change a family. Correct the source contracts where they currently disagree with the pinned SDK, the story, or each other.

## Inputs and verified constraints

- Story 1.3: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.
- Machine contract and tests: `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md` and `test-plan.md`.
- Current presenter: `packages/web/src/lib/tool-presentation.ts`; it has only the Story 1.1 summary subset and bounded count extraction.
- Pairing contract: `packages/web/src/lib/pair-tool-transcript.ts`; current and legacy rows can contain `unknown` output even though current providers serialize output as strings.
- Claude fixtures: pinned `@anthropic-ai/claude-agent-sdk@0.3.209` `sdk-tools.d.ts`. Do not execute a model merely to rediscover its declared shapes.
- Other shapes: OMP `event-parser.ts`, Devin `event-bridge.ts`, Grok `event-parser.ts`, Codex `provider.ts`, and read-only local-corpus observations.
- UI polling means body normalization must not happen in `toolPresentation()`, `toolRowPresentation()`, `buildAgentHistory()`, or transcript projection.

## Contract

Create `packages/web/src/lib/tool-output.ts` with exported display limits and one non-recursive normalizer. Exact numeric limits are chosen once in implementation and asserted at `limit`, `limit + 1`, and adversarially large inputs; the intended ceilings are approximately 64 Ki code units of parsed/displayed text and 500 rendered list items.

```ts
export interface ToolOutputMatch {
  path: string | null;
  line: number | null;
  text: string;
}

export interface ToolOutputField {
  key: string;
  value: string;
}

export interface NormalizedToolOutput {
  text: string | null;
  paths: BoundedList<string>;
  matches: BoundedList<ToolOutputMatch>;
  webResults: BoundedList<{ title: string | null; url: string }>;
  fields: ToolOutputField[];
  counts: { matches: number | null; files: number | null };
  mode: 'content' | 'files_with_matches' | 'count' | null;
  unreadable: boolean;
}

export interface BoundedList<T> {
  items: T[];
  /** 0 when complete, positive when the exact omitted count is known, null when inexact. */
  omitted: number | null;
  truncated: boolean;
}

export function normalizeToolOutput(output: unknown): NormalizedToolOutput;
```

This is a channel object, not a discriminated first-hit union. For example, a Grep result can expose `mode`, `matches`, and `counts` together, while WebSearch can expose result titles/URLs plus a count. Every returned string/list is already display-bounded.

In `tool-presentation.ts` add `ToolBody`, `MatchItem`, `ToolField`, and:

```ts
export function toolBodyPresentation(
  input: ToolPresentationInput,
  resolvedFamily: ToolFamily
): ToolBody | null;
```

`ToolPresentation` and `ToolRowPresentation` remain summary-only. `toolBodyPresentation()` must use the supplied family; it must not invoke family resolution again. It returns `null` for todo/task, and catches malformed values to return a bounded unreadable/generic state without throwing.

## Recognized output shapes

Normalize structural keys only. No recursive “find the first string,” natural-language intent parser, or provider-name branch is allowed.

| Semantic channel | Recognized structure                                                                                | Evidence                                 |
| ---------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| text             | plain string; `content[{type:'text',text}]`                                                         | Codex / OMP / MCP-like results           |
| terminal         | `stdout` plus non-empty `stderr`                                                                    | Claude `BashOutput`                      |
| file preview     | `file.content`; `type:'create'` + `content`; `FileContent.content`; `Content.content`               | Claude read/write; Devin read/list       |
| byte output      | `output: number[]`, decoded with non-fatal `TextDecoder` only when capped values are integers 0-255 | Devin terminal                           |
| paths            | `filenames: string[]`; Grep paths form                                                              | Claude `GlobOutput` / `GrepOutput`       |
| matches          | Grep content string and Devin `file_matches[{path,matches[{line_number,content}]}]`                 | pinned Claude type / observed Devin rows |
| grep mode/counts | `mode`, `numMatches`, `numFiles`, `count`, recognized digit-only count                              | pinned SDK / OMP compatibility           |
| web fetch        | `result`, optional `url`/`code`                                                                     | Claude `WebFetchOutput`                  |
| web search       | `results` string entries or entries/content items with `title` and `url`                            | Claude `WebSearchOutput`                 |
| generic fields   | shallow own top-level entries, stable source order, scalars as text, objects `{…}`, arrays `[n]`    | Story 1.3 generic contract               |

Ignore unknown nested structures. An unknown JSON object contributes shallow generic fields but never preformatted JSON. Non-finite numbers and symbol/function values contribute nothing. Prototype properties are never scanned.

## Parsing, truncation, and salvage

- If `output` is already a record/array, inspect it directly for compatibility; do not stringify it.
- A non-JSON-looking string becomes bounded text. Strip ANSI CSI, OSC (including OSC-8 links), and escape/control sequences while producing the bounded result so no unbounded intermediate is created; retain ordinary newline/tab text.
- A JSON-looking string at or below the parse cap uses `JSON.parse`. An over-cap JSON-looking string is unreadable unless the narrow prefix salvage below succeeds; Raw remains available.
- On failed JSON parse, a bounded state-machine tokenizer may recover only a value associated with an allowlisted semantic key: `stdout`, `stderr`, `text`, `content`, or `result`. It must track key/value position, quotes, escapes, and nesting; do not return an arbitrary last literal.
- Decode complete JSON escapes. At a cut escape or lone high surrogate, end with U+FFFD rather than throw or silently drop content. Mark the normalized result unreadable when no honest semantic value can be recovered.
- List overflow is channel-specific. Show `+n more` only when an exact source total makes `omitted` known; otherwise set `truncated: true`, `omitted: null`, and show `more results omitted`. Do not scan an unbounded tail solely to compute an exact number.
- Bound command and code input separately from output. Code must remain substantially larger than the 80-character headline cap but need not be unbounded; a visible truncation state plus Raw is the safe contract.

## Per-family body resolution

| Family    | Body rule                                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shell     | command from `command`/`cmd`/`script`, else the complete wrapper-preserving sent name; bounded. Output from normalized text. Unreadable and empty/running states are explicit. Exit/outcome remains in existing row/body-bar facts.                                                   |
| file      | path from the established path-key priority. Preview: normalized text, else input `content`, `new_content`, `new_string`, or `new_str`, else null. Do not compute a diff.                                                                                                             |
| search    | Pattern/scope from existing inputs. Mode precedence below. Structured matches win over line parsing; content lines parse anchored `path:line:text`/`path-line-text` shapes, with unmatched lines retained as text-only items. Preserve channel-specific truncation/omission metadata. |
| glob      | Pattern/scope follows the existing Claude-vs-OMP path rule. Use normalized paths, otherwise non-empty text lines. Never parse line numbers.                                                                                                                                           |
| code      | Source/language from input, bounded with explicit truncation. Result from normalized text. Renderer performs highlighting.                                                                                                                                                            |
| web       | URL from input, title/results/text from normalized channels. WebSearch results become markdown list content whose links remain inert at render time.                                                                                                                                  |
| generic   | One shared cap of three fields across input fields followed by normalized output fields. Plain non-JSON output may be safe markdown after the fields. JSON fragments never become markdown.                                                                                           |
| todo/task | `null`; their bodies belong to Stories 1.5/1.6.                                                                                                                                                                                                                                       |

Search mode precedence:

1. recognized `input.output_mode`;
2. normalized output `mode` or unmistakable structured channel (`filenames`/paths versus matches);
3. exact sent-alias default: Claude `Grep` -> `files_with_matches`; lowercase observed `grep` and other search aliases -> `content`.

`count` produces body `kind: 'generic'` with a count field/badge; the resolved family remains `search`, so it does not enter the generic-fallback numerator. The small collapsed count extractor may add recognized numeric JSON keys under its existing low cap, but it must not call the full normalizer. A paths body uses `N files`; matches uses `N matches`.

## Source-contract corrections

Update the two spec files in the same change so implementation and authority do not continue to disagree:

- `tool-presentation-contract.md`: describe summary and lazy body APIs separately; add the file-preview and web arms shown in its own expanded-body table; state todo/task ownership; keep output unable to reclassify family.
- `test-plan.md`: correct its audit heading from Story 1.2 to Story 1.3; replace “absent -> matches” with the two sent-alias defaults; replace the generic assertion “contains no `{`” with checks that reject serialized object syntax/quoted JSON keys while allowing the required `{…}` marker. Record the raw-row versus logical-card denominator conflict and link the Phase 3 decision; do not rewrite that metric as settled before owner ratification.

Do not revise the epic AC, UX decisions, or unrelated later-story sections.

## Implementation sequence

1. Add red table tests for the normalizer and lazy body resolver. Use pinned Claude type fixtures and actual OMP/Devin/Codex serialized shapes.
2. Implement bounded primitive helpers: own-record access, scalar marker conversion, bounded ANSI/text production, shallow lists/fields, byte decoding, line parsing, and narrow JSON salvage.
3. Implement semantic channel extraction without provider branching or recursive scans.
4. Add `ToolBody` and `toolBodyPresentation()`; preserve every existing summary resolver assertion.
5. Extend only the lightweight count extraction needed by collapsed badges.
6. Update the two machine-contract documents and tests together.
7. Run focused tests, then all web tests, typecheck, lint, and format check.

## Test matrix

| Priority | Case                                                                            | Expected proof                                                                              |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| critical | Claude Bash JSON; OMP ANSI/OSC text; Devin byte array; Codex plain text         | same terminal semantics, escapes removed, bytes validated/bounded, no serialized JSON       |
| critical | Claude `Grep` absent/content/files/count and lowercase OMP `grep` absent        | paths/matches/paths/generic respectively; count labels correct                              |
| critical | Devin structured `file_matches`                                                 | path, line, and content retained without flattening away structure                          |
| critical | malformed/truncated JSON at each escape boundary                                | only allowlisted value salvage; replacement char at incomplete escape; otherwise unreadable |
| critical | unknown object input/output with nested objects and arrays                      | <=3 combined rows, literal `{…}`/`[n]`, no quoted JSON dump                                 |
| critical | output varied across every family fixture                                       | `toolPresentation(...).family` unchanged                                                    |
| high     | Claude read/write/edit and OMP/Devin file variants                              | path plus correct preview/fallback, never fabricated diff                                   |
| high     | Claude Glob and OMP glob/list_dir                                               | pattern/scope rule preserved; flat bounded paths                                            |
| high     | source >80 chars and >source cap; known/unknown language                        | not headline-truncated; display cap/truncation explicit; language preserved/sanitized later |
| high     | WebFetch and both WebSearch result variants                                     | URL/title/text/results retained; no raw object serialization                                |
| high     | todo/task fixtures                                                              | lazy body returns null; summary behavior unchanged                                          |
| medium   | `undefined`, null, empty, number, boolean, array, hostile proxy/getter          | no throw; safe empty/unreadable result                                                      |
| medium   | exact cap and cap+1 for text, JSON, bytes, list, fields, command, source        | deterministic bound and overflow behavior                                                   |
| medium   | byte values negative, >255, fractional, or non-number                           | unreadable/no decode; never silent modulo coercion                                          |
| medium   | Windows path match, colon in match text, separator lines, malformed line number | no wrong line/path split; unmatched content retained                                        |

Tests must distinguish serialized JSON (`{"key":`, indented quoted keys, object dump) from valid source braces and `{…}`. Do not use a global ban on `{`.

## Files

| Path                                                                    | Action                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/web/src/lib/tool-output.ts`                                   | create normalizer and bounded helpers                                           |
| `packages/web/src/lib/tool-output.test.ts`                              | create provider/adversarial/boundary tables                                     |
| `packages/web/src/lib/tool-presentation.ts`                             | add body types/resolver and bounded count support; remove story-number docblock |
| `packages/web/src/lib/tool-presentation.test.ts`                        | add family-body, grep precedence, invariant, and no-serialization tables        |
| `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md` | reconcile canonical API/arms                                                    |
| `_bmad-output/specs/spec-agent-node-room/test-plan.md`                  | reconcile grep/generic/audit tests                                              |

Do not change `agent-history.ts` or the Console allowlist in this phase. The renderers will import the body resolver through the already-approved `@/lib/tool-presentation` boundary.

## Verification

```bash
cd packages/web && bun test src/lib/tool-output.test.ts src/lib/tool-presentation.test.ts
bun --filter @archon/web test
bun run type-check
bun run lint --max-warnings 0
bun run format:check
```

## Completion criteria

- [ ] Normalizer exposes simultaneous bounded semantic channels for all verified shapes.
- [ ] Lazy resolver covers shell/file/search/glob/code/web/generic and returns null for todo/task.
- [ ] Closed-row summary functions do not invoke full normalization.
- [ ] Output cannot change family; all existing Story 1.1 tests stay green.
- [ ] Claude/OMP rows exist in every applicable table, with Devin/Codex rows where their shapes differ.
- [ ] Contract and test-plan contradictions are corrected.
- [ ] Focused and web-wide verification passes.

## Risks and responses

| Risk                                    | Detection                             | Response                                                    |
| --------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| Salvage extracts the wrong literal      | adversarial nested/key/value fixtures | key-position tokenizer, allowlist only, unreadable fallback |
| Full-output payload blocks the UI       | cap+1/huge input tests                | reject over-cap JSON, bound all scans and rendering         |
| Grep pending row chooses wrong arm      | exact-name/default table              | explicit structural/mode/alias precedence                   |
| Normalizer becomes provider switchboard | review sees provider identifiers      | encode documented shapes as structural extractors only      |
| Generic fields exceed story cap         | combined input/output fixture         | one accumulator and one three-row budget                    |

## Rollback

Remove `tool-output.ts`, the body types/resolver/tests, and the two doc corrections. Existing summary presentation and stored/API contracts remain unchanged.
