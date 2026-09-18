---
title: 'Phase 1: Shared presentation and history projection'
status: todo
depends_on: []
---

# Phase 1: Shared presentation and history projection

## Objective

Create the pure Story 1.1 row model and attach it at the shared history seam. Preserve current stored data, tool identity, full-output fields, caller return type, and non-tool ordering while adding exit-code facts and the required adjacent-interruption fold.

## Files

| Path                                                                                  | Action                  | Purpose                                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/tool-presentation.test.ts`                                      | Create first            | Resolver, headline, row-state, badge, and bounds tests                                       |
| `packages/web/src/lib/tool-presentation.ts`                                           | Create after red tests  | React-free row presentation policy                                                           |
| `packages/web/src/lib/agent-history.test.ts`                                          | Modify first            | Exit-code propagation, presentation integration, interruption fold, ordering                 |
| `packages/web/src/lib/agent-history.ts`                                               | Modify after red tests  | Shared projection integration                                                                |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                        | Modify after projection | Pass its existing per-render clock snapshot                                                  |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                 | Modify after projection | Pass its existing per-render clock snapshot                                                  |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx` | Modify after projection | Pass its existing per-render clock snapshot                                                  |
| `e2e/ui/workflow-run-hitl.spec.ts`                                                    | Modify first            | Replace two obsolete visible-output cases with desired Console/Legacy row behavior           |
| `e2e/ui/workflow-run-hitl-room.spec.ts`                                               | Modify first            | Replace `[V:hitl.agent-history]` obsolete assertions with the desired detailed-room behavior |

Read `pair-tool-transcript.ts` and its tests, but do not modify them unless a new failing contract test proves that pairing loses required data.

## Row model

Define fully typed, render-neutral types in `tool-presentation.ts`:

- `ToolFamily`: `shell | file | search | glob | code | todo | task | web | generic`.
- Keep canonical `ToolPresentationInput` structural and exact: `name`, `input`, and `output`; it must not import React or depend on `AgentHistoryItem`.
- Implement the Story 1.1 row subset of canonical `ToolPresentation`: family, chip label, headline, `headlineKind`, and content-derived badge facts. Later stories extend it with bodies rather than adding provider decisions to renderers.
- `ToolRowFacts`: already-derived outcome, exit code, duration, and output state.
- `ToolRowBadge`: stable `kind`, human text, and semantic tone. Required kinds for this story are `state` (visible `running`/`interrupted` facts), `duration`, `exit`, `count`, `language`, `operation`, `output-state`, and `placeholder`; render order and drop priority are data, not renderer guesses.
- `ToolRowPresentation`: the content presentation plus glyph, status label, initial-open policy, and final ordered typed badges.
- Export canonical `toolPresentation(input)` plus `toolRowPresentation(input, facts)`, which composes the content with runtime facts. This second concrete caller is needed by shared history and by local full-output refresh; neither renderer rebuilds policy.
- Catch at the public content-presentation boundary and return a safe generic family/label/headline if content presentation unexpectedly fails. Row composition must still preserve the already-derived outcome glyph and operational facts.
- Reuse the shared `lib/format.ts` duration formatter so Legacy and Console stop formatting this badge through separate helpers.

Final badge order is deterministic: visible running/interrupted state; content fact (language/count/operation); exit code; non-full output state; duration last. Apply the canonical state rules before generic output-state composition: a running call says `running · <elapsed>` and suppresses its not-yet-produced `missing` state; interrupted says `interrupted`; unknown says `output unknown`. Those three state rules replace inferred missing/unknown markers; settled succeeded/failed calls retain their recorded `truncated`, `output missing`, or `output unknown` marker. If no fact remains, render one `—` placeholder so badge alignment does not shift. Duration is last visually and the only first-drop fact; the body bar repeats real facts in the same order after its family word but does not repeat the placeholder.

For completed tools, keep the current exact matching `tool_completed.data.duration_ms`. For a running tool with no completion, use one exact matching `tool_called` event's `created_at` (parsed with the existing UTC helper) and `max(0, nowMs - startedAt)`; invalid, missing, or ambiguous starts produce no elapsed badge rather than a guess. Hoist each production caller's existing `Date.now()` snapshot before `buildAgentHistory()` and pass it through so Ask cards and tool rows share one render clock. Existing one-second live history refreshes drive updates; add no interval or lifecycle mutation.

The current `AgentHistoryItem` tool arm gains `exitCode` and `presentation`. Keep `name`, `input`, `output`, `outcome`, `durationMs`, `canLoadFullOutput`, `outputState`, `messageId`, and identity fields. Remove `context` only in Phase 2 after both renderers stop reading it. `buildAgentHistory()` continues returning `AgentHistoryItem[]`, but `AgentHistoryInput` gains required `nowMs` for deterministic running elapsed time.

## Resolver and headline rules

Resolution order is fixed and exact:

1. Recognize the bounded exact `mcp__server__tool` shape and force the contract's generic `server · tool` presentation; its input keys must not reclassify it.
2. Case-fold the bounded candidate name and remove `_`/`-` for exact alias lookup. Never use substring matching.
3. For an unmatched bounded name, infer from known input keys in contract priority: code+language; command/cmd/script; file path keys; pattern/query keys; URL keys; before/after pairs.
4. An absent/empty input with a command-like or overlong multiline name is the Codex name-only shell path.
5. Otherwise use generic.

Use the complete contract aliases:

| Family | Normalized exact aliases                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| shell  | `bash`, `shell`, `run`, `command`, `execute`, `runterminalcommand`                                                                          |
| file   | `edit`, `write`, `create`, `strreplace`, `applypatch`, `notebookedit`, `searchreplace`, `delete`, `read`, `view`, `cat`, `open`, `readfile` |
| search | `grep`, `search`, `rg`, `searchtool`                                                                                                        |
| glob   | `glob`, `find`, `ls`, `list`, `listdir`                                                                                                     |
| code   | `eval`, `runcode`, `execute code`                                                                                                           |
| todo   | `todo`, `todowrite`, `plan`                                                                                                                 |
| task   | `task`, `agent`, `subagent`, `dispatch`                                                                                                     |
| web    | `webfetch`, `websearch`, `fetch`, `browse`                                                                                                  |

Headline behavior:

- Shell: direct `command`/`cmd`/`script`, or the bounded first non-empty line of the name-only command. Strip only a complete matching `/bin/zsh -lc '…'` or `/bin/bash -lc '…'` wrapper; add `…` when later non-empty lines exist. Never mutate the stored name/input.
- File: first string in `file_path`, `path`, `target_file`, `file`, `filename`, `notebook_path`; path kind.
- Search: pattern/query/regex/search, optionally followed by a bounded scope; text kind.
- Glob: if `pattern` exists, it is the headline and `path` is scope; otherwise `path` is the headline and scope is null. Use path kind in both cases.
- Code: first non-empty line of `code`, with language as a badge; text kind.
- Todo: the documented folded-call headline `todo updated`, with a bounded scalar `op: <op>` badge when present; no cross-call fold, phase names, or progress computation.
- Task: bounded `description`, first task name, or context first line in that order; no subtask normalization/body.
- Web: `url`/`uri`; path kind so the final URL segment survives.
- Generic/MCP: up to three scalar top-level `key: value` facts in encounter order. Skip objects/arrays in the collapsed summary. If no scalar exists, use the compact label/tool name. MCP `mcp__server__tool` resolves generic and displays `server · tool`.

The chip displays the exact provider-sent name only when a bounded code-point scan proves it is one whitespace-free token of at most 24 code points. Otherwise use the family label. Do not normalize or CSS-truncate a valid displayed name.

## Explicit bounds

Use named constants and test the limit and limit+1 cases. These values bound work without changing the visible CSS elision contract:

- `MAX_ALIAS_NAME_CODE_UNITS = 128`: names beyond it skip normalization/alias lookup and use structural or name-only resolution.
- `MAX_CHIP_CODE_POINTS = 24`: stop scanning as soon as point 25 or whitespace is found.
- `MAX_HEADLINE_SOURCE_CODE_UNITS = 4096`: inspect at most this much before searching for lines or wrappers. An accepted ordinary headline remains complete in the DOM and is visually elided only by CSS; if the required end/line cannot be established inside the cap, use the safe family/tool fallback instead of fabricating a truncated path.
- `MAX_GENERIC_KEYS_SCANNED = 32`: bounded own enumerable property iteration; stop without materializing all keys.
- `MAX_GENERIC_FACTS = 3` and `MAX_GENERIC_SCALAR_CODE_POINTS = 80`.
- `MAX_COUNT_OUTPUT_CODE_UNITS = 4096` and `MAX_COUNT_KEYS_SCANNED = 32`: reject longer strings before optional JSON parsing; inspect only finite nonnegative integer scalar output or shallow exact count fields. Never regex arbitrary provider prose, recurse, or fetch full output.

Known-family keys are direct reads before generic enumeration. Inputs are schema-parsed JSON values, not Proxies or accessor-bearing objects; tests should model that real boundary.

## Outcome, exit code, and interruption

- Extract exit code once with current precedence: result metadata, call metadata, paired card. Reuse it in `deriveOutcome()` and carry it to the presenter.
- Keep current normal outcome precedence for rows without an adjacent override.
- Implement the cross-provider interruption fold as a single ordered look-ahead in `buildAgentHistory()`: when a tool card is immediately followed by a status message whose state is exactly `interrupted`, project the tool with outcome `interrupted`, recompute its status presentation, consume that one status, and advance. This final override wins over failed metadata/exit code for display; the exit badge may remain as a fact if recorded.
- Do not fold on detail text, substring matches, other states, or across any intervening item. Direct-result `interrupted` continues to work without an adjacent status row.

## Tests before production code

Add these failing tests first:

| Area                 | Required cases                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alias/classification | Every alias; case/underscore/hyphen normalization; `search_replace` collision; unknown; MCP label; name over normalization bound                                                          |
| Provider shapes      | Claude and OMP glob inversion; Codex absent input and complete wrapper; incomplete wrapper unchanged; web URL; code+language; todo op                                                     |
| Chip/headline        | 24 vs 25 code points, Unicode, whitespace/newline, first non-empty command/code line, long/multiline input, all family fallbacks; rejected names do not leak into chip accessibility text |
| Generic safety       | null, arrays, object-only input, three scalar facts, fourth fact omitted, 32/33 keys, deep object, huge string; no brace/bracket marker in headline                                       |
| Outcomes             | One table for succeeded/failed/running/interrupted/unknown glyph, label, initial-open state, and documented state badge/placeholder (`running`, `interrupted`, `output unknown`, or `—`)  |
| Badges               | Ordered state/content/exit/output-state/duration; running suppresses premature missing; output-state wording and `—` placeholder preserved; bounded count; unsupported count omitted      |
| Projection           | Exit precedence; completed duration; deterministic running elapsed from exact `tool_called`; missing/ambiguous/invalid start; direct/adjacent interruption; stable order and IDs          |

Change all three obsolete E2E cases before implementation. Their new assertions must target `details[data-tool-id] > summary`, assert the success row is closed, verify chip/headline text, and assert Input/Output/payload output are not visible. Keep uppercase `HITL` in titles so CI still selects them. Record the expected red result against the old card UI.

## Implementation order

1. Run the ownership/worktree preflight from `plan.md`.
2. Rewrite the three stale E2E cases and confirm they fail for the intended old-UI reason.
3. Add and run presenter red tests.
4. Add and run history projection red tests.
5. Implement types, bounds, exact aliases, direct-key headline rules, generic fallback, and row-state/badge composition.
6. Factor exit-code derivation so outcome and presentation consume the same value.
7. Add presentation in `toToolItem()`, derive deterministic running elapsed, and implement exact adjacent look-ahead folding.
8. Hoist/pass the existing per-render `nowMs` in all three callers without adding a timer.
9. Refactor only duplication introduced or superseded in shared code; retain `context` until Phase 2.

## Verification

Run from `packages/web`:

```bash
bun test src/lib/tool-presentation.test.ts
bun test src/lib/agent-history.test.ts src/lib/pair-tool-transcript.test.ts
bun run type-check
```

Run from `e2e` and expect only the three outside-in cases to remain red until Phase 2:

```bash
npx playwright test -c playwright.config.ts ui/workflow-run-hitl.spec.ts ui/workflow-run-hitl-room.spec.ts --grep "HITL.*readable tool row"
```

## Exit criteria

- [ ] Pure presentation and all boundary tests pass with no `any` and no React import.
- [ ] Exit code reaches the history item and renderer-ready presentation.
- [ ] Adjacent interrupted status overrides and disappears; every nonmatching status remains.
- [ ] No presenter path performs unbounded normalization, key enumeration, line search, recursion, or output parsing.
- [ ] `buildAgentHistory()` and all existing consumers still type-check with its array return.
- [ ] No later-story body, Raw, diff, todo state, task normalization, or occurrence abstraction is added.
- [ ] Exactly three rewritten HITL cases are red only because renderers have not moved yet.

## Rollback

Revert the new presenter, shared-history additions, and the three E2E expectation edits together. Persistence and pairing are unchanged, so there is no data rollback.
