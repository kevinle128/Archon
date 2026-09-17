---
title: 'Phase 1: Shared tool-row presentation'
status: todo
depends_on: []
---

# Phase 1: Shared tool-row presentation

## Objective

Create the pure row presentation contract and integrate it at the single shared history projection point.
This phase must preserve stored data and existing caller contracts while exposing the complete row model that both renderers need.

## Requirements

- [ ] Resolve the nine tool families with exact normalized aliases before bounded structural checks.
- [ ] Never use substring matching, because `search_replace` is an edit and not a search.
- [ ] Keep the provider-sent tool name for the chip only when it is one token and at most 24 characters.
- [ ] Produce a one-line headline, path or text elision kind, status glyph and label, and ordered badge data.
- [ ] Strip only the fixed Codex shell wrapper for the headline and preserve the stored name.
- [ ] Cap generic field scanning, generic scalar count, scalar length, headline source length, and count-badge extraction with named constants.
- [ ] Catch unexpected presentation failures at the public boundary and return a safe generic row.
- [ ] Treat presenter input as valid JSON values from schema-parsed tool rows; keep corrupt persisted-row handling in the existing API error path.
- [ ] Preserve exit code instead of discarding it after outcome derivation.
- [ ] Fold only an immediately following status row whose state is exactly `interrupted` into the preceding tool call.
- [ ] Keep `buildAgentHistory()` returning `AgentHistoryItem[]` for Story 1.1.
- [ ] Do not add the later todo aggregate, body union, diff, Raw, or occurrence contracts.

## File inventory

| Path                                             | Action                 | Purpose                                                                           |
| ------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------- |
| `packages/web/src/lib/tool-presentation.test.ts` | Create first           | Pure presenter and state-policy tests.                                            |
| `packages/web/src/lib/tool-presentation.ts`      | Create after red tests | Row-only presentation policy.                                                     |
| `packages/web/src/lib/agent-history.test.ts`     | Modify first           | Exit-code, presentation integration, and interruption-fold tests.                 |
| `packages/web/src/lib/agent-history.ts`          | Modify after red tests | Shared integration owner.                                                         |
| `e2e/ui/workflow-run-hitl.spec.ts`               | Modify first           | Replace the old visible-output contract with a red collapsed-row acceptance test. |
| `e2e/ui/workflow-run-hitl-room.spec.ts`          | Modify first           | Add the same red acceptance contract through the detailed room workflow.          |

Read `packages/web/src/lib/pair-tool-transcript.ts`, but do not modify it unless a failing contract test proves that the current pairing lost required data.

## Tests before implementation

Add failing tests before production code.

| Scenario                                                                                     | Test level             | Expected result                                                                                                         |
| -------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Exact alias table for all nine families                                                      | Unit table             | Each alias selects the documented family.                                                                               |
| Representative Claude and OMP rows in the family table                                       | Unit table             | Both provider shapes reach the same row contract.                                                                       |
| `search_replace` alias collision                                                             | Unit                   | Resolves to file and never search.                                                                                      |
| Claude and OMP glob shapes                                                                   | Unit table             | Claude `{ pattern, path }` headlines the pattern with path as scope; OMP `{ path }` headlines the path with null scope. |
| Chip boundary                                                                                | Unit table             | 24-character one-token names pass unchanged; whitespace, line breaks, and 25 characters use the family.                 |
| MCP name                                                                                     | Unit                   | Resolves to generic with the compact `server · tool` label.                                                             |
| Codex shell name and multi-line command                                                      | Unit                   | Fixed wrapper is absent from the headline and only the first non-empty line appears.                                    |
| Generic scalar fallback                                                                      | Unit                   | At most three `key: value` facts appear, values stop at 80 characters, and objects and arrays become bounded summaries. |
| Null, arrays, deep objects, wide objects, long strings, missing fields, and unknown metadata | Unit                   | The presenter terminates, does not throw, and returns a generic row within all caps.                                    |
| Five outcome states                                                                          | One focused unit table | Glyph, accessible label, and initial open policy match the required table.                                              |
| Exit code and output-state facts                                                             | Unit                   | Exit and truncation or missing facts reach the ordered badges.                                                          |
| `output_mode: count` with small and huge JSON outputs                                        | Unit                   | Count badges are bounded and do not scan a full unloaded or oversized output.                                           |
| Call plus direct interrupted result                                                          | Shared projection      | Existing interrupted behavior remains correct.                                                                          |
| Call plus immediate interrupted status                                                       | Shared projection      | The tool changes to interrupted and the status row disappears.                                                          |
| Call plus intervening text or lifecycle row                                                  | Shared projection      | No interruption fold crosses the intervening row.                                                                       |
| Multiple malformed rows                                                                      | Shared projection      | Each row remains isolated and ordering stays stable.                                                                    |

## Interface and function checklist

- [ ] Define a render-neutral `ToolFamily` union for the nine families.
- [ ] Define a structural presenter input that accepts the stored name, input, output, outcome, exit code, duration, and output state without importing React.
- [ ] Define the Story 1.1 row presentation fields: family, label, headline, headline kind, glyph, accessible status label, initial-open policy, and typed badge descriptors.
- [ ] Give badges a stable kind so CSS can drop duration before critical exit or count facts.
- [ ] Export one pure presenter entry point and one shared initial-open policy.
- [ ] Keep family resolution helpers private unless an existing caller requires them.
- [ ] For glob, use `pattern` as the headline when present and use `path` only as scope; otherwise use `path` as the headline and set scope to null.
- [ ] Keep grep body-arm selection out of Story 1.1, except for the bounded `output_mode: count` row badge.
- [ ] Replace `toolContext()` only after its two renderer consumers move in Phase 2.
- [ ] Keep `input`, `output`, `messageId`, and `canLoadFullOutput` on the history item for later stories and current diagnostics.
- [ ] Preserve `data-tool-id` inputs and stable tool-card identity.

## Implementation steps

1. Recheck issue #174, related pull requests, and the reported Archon Loop run before editing production files.
2. Replace the two stale visible-output E2E assertions with collapsed readable-row assertions and record that they fail against the current UI for the intended reason.
3. Add the presenter red tests and confirm that they fail because the module does not exist.
4. Add the history projection red tests and confirm the missing exit-code and interruption-fold behavior.
5. Implement the smallest React-free presenter that satisfies the Story 1.1 row fields.
6. Read only a fixed key list for known family signals and stop generic enumeration after the named scan cap.
7. Stop output-derived count work at the declared cap and never fetch full output only to build a collapsed badge.
8. Integrate the presenter in `toToolItem()` after deriving outcome, exit code, duration, and output state once.
9. Fold the adjacent interruption during the single ordered `buildAgentHistory()` pass without scanning backward across another item.
10. Keep direct result metadata as the higher-precedence outcome source.
11. Keep superseded context helpers until both renderers move in Phase 2.

## Refactor

- [ ] Remove duplicate outcome, label, or badge decisions found in shared code.
- [ ] Keep the alias tables and bounds local to the presenter.
- [ ] Do not extract a factory, provider normalizer layer, or future body abstraction.
- [ ] Keep all functions fully typed and avoid `any`.

## Tests after implementation

Run from `packages/web`.

```bash
bun test src/lib/tool-presentation.test.ts
bun test src/lib/agent-history.test.ts src/lib/pair-tool-transcript.test.ts
bun run type-check
```

From `e2e`, run the two new acceptance cases and confirm that they remain red until Phase 2.

```bash
npx playwright test -c playwright.config.ts ui/workflow-run-hitl.spec.ts ui/workflow-run-hitl-room.spec.ts --grep "readable tool row"
```

## Regression gate

- [ ] All new presenter tests pass.
- [ ] All shared history and call/result pairing tests pass.
- [ ] Existing text projection, event duration, output-state, and direct interrupted-result behavior stays green.
- [ ] TypeScript reports no widened or unsafe type.
- [ ] Both outside-in E2E cases fail only because the current cards do not yet implement the readable collapsed row.

## Dependencies

This phase depends only on current stored transcript and workflow event contracts.
Phase 2 consumes the new tool-row presentation on `AgentHistoryItem`.
Phase 3 relies on the stable row identity and state policy from this phase.

## Risks and rollback

- A broad resolver can misclassify stored tools, so exact aliases must win and generic must remain safe.
- A scan bound can hide a useful late field, so known headline keys must use fixed direct lookup before bounded generic enumeration.
- Count extraction can traverse a large output, so it needs a separate cap and must not load full output for a summary badge.
- The interruption fold can consume a real lifecycle event, so it must match only the exact adjacent `interrupted` state.
- Rollback is a direct revert of the two new files and the two shared-history edits because persistence is unchanged.

## Success criteria

- [ ] The presenter is pure, React-free, deterministic, and safe for schema-valid unusual JSON input.
- [ ] The presenter handles all schema-valid unusual JSON values and does not claim to repair corrupt persisted rows.
- [ ] The five outcome states pass one table-driven test.
- [ ] Exit code and all current output-state facts reach the row model.
- [ ] Immediate interruption folding works without changing other lifecycle rows.
- [ ] No later-story body, Raw, todo, diff, task, or occurrence behavior exists.
- [ ] The outside-in E2E acceptance tests are red for the intended pre-implementation reason.
