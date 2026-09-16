# Story 1.1 evidence — Scan a tool call as one readable row

Date: 2026-09-16

## Commits

Exact output of `git log --reverse --format='%H %s' --grep='readable rows' --grep='readable tool row'`:

```
05cec0e7b1cc0f0157ffb931277ca4ea6a3c63d6 feat(web): complete readable tool row presentation
44d134e9b9edb0a0fe2a231ae1a98f4ef1bafb3f feat(web): project readable tool row status and badges
0ef9bddad7fc1bd8b5fc86deac2bbd6e2c7e9e3e feat(web): render Legacy tool calls as readable rows
bf0aff9cca28606ee18f7aa8dc0cb55690aea3c5 feat(web): render Console tool calls as readable rows
```

Closing commit (this change): `refactor(web): remove superseded tool context and close ANR 1.1`

Also on the branch (does not match the grep above):

```
db27ddf9 feat: Classify tool calls to families
```

## Focused Story 1.1 tests

Commands run on 2026-09-16 after removing `toolContext` / `TOOL_CONTEXT_KEYS` / the tool-item `context` field. Zero failures.

| Command                                                                                                        | Result                              |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `bun test --cwd packages/web src/lib/tool-presentation.test.ts`                                                | 15 pass, 0 fail, 120 expect() calls |
| `bun test --cwd packages/web src/lib/agent-history.test.ts`                                                    | 12 pass, 0 fail, 39 expect() calls  |
| `NODE_ENV=development bun test --cwd packages/web src/components/workflows/NodeRoom.test.tsx`                  | 12 pass, 0 fail, 68 expect() calls  |
| `NODE_ENV=development bun test --cwd packages/web src/experiments/console/components/ConsoleNodeRoom.test.tsx` | 20 pass, 0 fail, 113 expect() calls |
| `bun test --cwd packages/web src/experiments/console/console-isolation.test.ts`                                | 4 pass, 0 fail, 17 expect() calls   |

## Package tests

`bun --filter @archon/web test` — all legs 0 fail:

| Leg                                                                                   | Result                                          |
| ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `bun test src/lib/`                                                                   | 348 pass, 0 fail, 874 expect() calls, 33 files  |
| `bun test src/stores/`                                                                | 51 pass, 0 fail, 91 expect() calls, 1 file      |
| `bun test src/hooks/`                                                                 | 18 pass, 0 fail, 26 expect() calls, 2 files     |
| `NODE_ENV=development bun test src/components/`                                       | 416 pass, 0 fail, 1835 expect() calls, 58 files |
| `NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx` | 53 pass, 0 fail, 188 expect() calls, 1 file     |
| `NODE_ENV=development bun test src/experiments/console/`                              | 885 pass, 0 fail, 2736 expect() calls, 83 files |

## Context-path cleanup

Removed from `packages/web/src/lib/agent-history.ts`: tool-item `context` field, `TOOL_CONTEXT_KEYS`, `toolContext()`, and the `toToolItem()` assignment. Deleted the `toolContext` describe block from `agent-history.test.ts` and `context` from the Legacy `toolItem()` fixture plus the `rowViewItem()` helper.

`rg -n "toolContext|TOOL_CONTEXT_KEYS" packages/web/src` — no matches.

`rg -n "\.context\b|toolContext|TOOL_CONTEXT_KEYS" packages/web/src` still matches three DAG-node `context` (`'fresh'` session inheritance) sites, not the removed tool-item field:

```
packages/web/src/components/workflows/WorkflowCanvas.tsx:153:      context: node.data.context || undefined,
packages/web/src/components/workflows/NodeInspector.tsx:291:                updates.context = undefined;
packages/web/src/components/workflows/NodeInspector.tsx:505:              value={node.context ?? ''}
```

Those lines are the workflow YAML `context:` field. They are outside Story 1.1 and were not production readers of `AgentHistoryItem.context`.

## Acceptance-criterion to test-group map

- One-line anatomy and initial disclosure state → `NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx` readable-row tests.
- The five-outcome table → `agent-history.test.ts` `initial expansion is table-driven for all five outcomes`.
- Glyphs and chip rules → the `toolRowView` glyph table and `tool-presentation.test.ts` display-contract tests.
- Safe degradation and bounded scalar formatting → `tool-presentation.test.ts` malformed and generic headline tests.
- Exit-code visibility → the shared badge-order test and both renderer tests.
- Interrupted folding → `agent-history.test.ts` interrupted lifecycle fold tests.
- Console isolation → `console-isolation.test.ts`.

## Repository gate

`bun run validate` exited 0 on 2026-09-16 (135.34s). Generated-file checks, type-check, lint `--max-warnings 0`, format check, `test:install`, and isolated package test legs all passed.

Pre-existing gates unblocked in this iteration (zero story files in those commits):

```
589db3fec087de03d30f04a00ce0483c7d3d0161 chore(unblock): fix pre-existing scripts type-check blocking bun run validate
5c8f8d6b2c33e7cce8387c365ca5242d7e8e9a09 chore(unblock): fix pre-existing workflows tests blocking bun run validate
```
