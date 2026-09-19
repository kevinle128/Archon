---
phase: 2
title: 'Structured transcript presentation'
status: pending
priority: P1
effort: 'medium'
dependencies: [1]
---

# Phase 2: Structured transcript presentation

## Outcome

All production transcript mounts display an exact schema-declared single string envelope as readable Markdown while the durable assistant text and structured engine result remain unchanged.

## Context links

- [Structured-output presentation research](./research/researcher-01-structured-output-presentation.md)
- [Runtime-flow and E2E research](./research/researcher-03-e2e-tdd-runtime-flow.md)
- `.archon/workflows/defaults/ak-implement.yaml`
- `_bmad-output/specs/spec-agent-node-room/SPEC.md`

## Requirements

- Add optional `outputFormat?: Record<string, unknown>` presentation context to `AgentHistoryInput`.
- Apply the display transform only after `projectTextTranscript()` completes delta and snapshot projection.
- Require `type: 'object'`, exactly one declared property, and an exact string property schema.
- Require the complete assistant text to parse as a plain object with exactly that declared own key and a string value.
- Require the raw assistant text to equal `JSON.stringify(parsed)` before unwrapping so duplicate keys, noncanonical whitespace, and escape transformations fail closed.
- Use the string value as Markdown only when every guard passes.
- Preserve original text byte-for-byte for absent schema, malformed JSON, fences, prose plus JSON, arrays, primitives, null, missing keys, extra keys, non-string values, and multi-field schemas.
- Pass the optional schema to Legacy, Console selected room, and Console inline execution history, including nested definition nodes.
- Keep persisted rows, API output, item identity, sequence, execution metadata, tool Raw behavior, and downstream structured output unchanged.
- Apply the rule independently to every exact-matching projected assistant block, including intermediate blocks separated by tool rows, rather than only the terminal result.
- Set the E2E fake provider's `structuredOutput` capability to true only after its strict opt-in scenario emits the real `structuredOutput` chunk contract.

## Architecture

`buildAgentHistory()` is the shared render-neutral policy seam.
Legacy obtains the matched definition through `LegacyNodeRoom` and forwards `definitionNode?.output_format` through `NodeTranscriptPane`.
The Console selected room already owns the matched definition and passes its schema directly.
`ConsoleInspectPane` resolves nested definition nodes with the existing helper and forwards the schema to each inline `ConsoleExecutionHistory`.
Both final renderers keep their existing Markdown contract.

## Files

| File                                                                                       | Action               | Change                                                                                                                  |
| ------------------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/agent-history.test.ts`                                               | Modify first         | Add the full schema and payload decision matrix, delta-before-unwrap order, and immutability assertions.                |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                            | Modify first         | Prove readable Legacy rendering and lossless fallback.                                                                  |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Modify first         | Prove selected-room parity.                                                                                             |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Modify first         | Prove inline-history parity.                                                                                            |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx`              | Modify first         | Prove definition loading and nested-node schema forwarding to both Console mounts.                                      |
| `e2e/fixtures/workflows/e2e-transcript-display.yaml`                                       | Create first         | Define one report producer, one downstream field consumer, and deterministic output schema.                             |
| `packages/providers/src/e2e-fake/provider.test.ts`                                         | Modify first         | Prove the narrow structured-report fake scenario and unchanged default behavior.                                        |
| `packages/providers/src/e2e-fake/capabilities.ts`                                          | Modify with provider | Make the capability declaration match the implemented structured-output behavior and remove the stale contrary comment. |
| `e2e/ui/workflow-transcript-display.spec.ts`                                               | Create first         | Reproduce raw JSON in all three mounts and prove the immutable API payload and downstream field use.                    |
| `packages/web/src/lib/agent-history.ts`                                                    | Modify               | Add the exact schema-gated display projection.                                                                          |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                             | Modify               | Accept and forward optional output format.                                                                              |
| `packages/web/src/components/workflows/LegacyNodeRoom.tsx`                                 | Modify               | Supply the selected definition node schema.                                                                             |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                      | Modify               | Supply the selected definition node schema.                                                                             |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`      | Modify               | Accept and forward optional output format.                                                                              |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`                   | Modify               | Resolve and forward nested definition schemas for inline history.                                                       |
| `packages/providers/src/e2e-fake/provider.ts`                                              | Modify               | Add one strict, opt-in fragmented structured-report scenario for the browser boundary.                                  |
| `e2e/lib/playwright/archon-runtime.ts`                                                     | Modify               | Seed and run the new deterministic workflow in an isolated worker runtime.                                              |

## Function and interface checklist

- `buildAgentHistory(input)` gains one optional internal input and remains the only production transformer.
- The display helper stays local to `agent-history.ts` unless a third production owner appears.
- `resolveRoomKind()` remains the nested-node lookup owner in each shell.
- `projectTextTranscript()` and both Markdown renderer components remain unchanged.
- Generated API declarations and server routes remain unchanged.

## Tests Before

1. Add unit tests that fail on the current raw JSON copy behavior, including exact intermediate blocks separated by tool rows.
2. Add component tests that fail if any of the three production callers omits the schema.
3. Add the isolated browser fixture and confirm the Legacy room, Console room, and Console inline history show the serialized wrapper before the fix.
4. In the same browser proof, fetch node messages and assert the stored text is still exact JSON.
5. Make the downstream consumer echo `$report-node.output.report` to prove engine field semantics cannot be replaced by display prose.
6. Prepare malformed, extra-key, multi-field, schema-less, duplicate-key, and noncanonical-escape rows before claiming browser fallback coverage.

## Implementation steps

1. Parse only projected complete text and return early when the schema is absent or not the exact one-string object shape.
2. Accept only a plain parsed object with the same single own key and a string value whose canonical serialization is identical to the raw text.
3. Copy the unwrapped value into each qualifying `AgentHistoryItem` while preserving all other item and row fields.
4. Add optional prop plumbing through Legacy and both Console history owners.
5. Reuse the existing nested-node resolver for Console inline rows.
6. Keep definition-load failure behavior fail-closed to original transcript text.
7. Update the fake provider capability only after the scenario honors `output_format` through a terminal `structuredOutput` chunk, and assert the capability in its provider test.

## Refactor

Do not create a generic JSON-to-Markdown renderer.
Do not duplicate parsing in React components.
Keep the exact guard as a small local helper and remove any repeated schema inspection introduced during wiring.

## Tests After

```bash
(cd packages/web && bun test src/lib/agent-history.test.ts src/lib/project-text-transcript.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx)
(cd packages/providers && bun test src/e2e-fake/provider.test.ts)
bun run build:web
(cd e2e && npm run typecheck && npx playwright test -c playwright.config.ts ui/workflow-transcript-display.spec.ts --grep 'structured report')
```

## Test scenario matrix

| Scenario                                       | Expected result                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Exact one-string schema and object             | Display only the string value as Markdown.                                                             |
| JSON assembled from deltas                     | Assemble first, then unwrap once.                                                                      |
| Missing definition                             | Display original text.                                                                                 |
| Malformed, fenced, or prose-wrapped JSON       | Display original text.                                                                                 |
| Extra payload key or multiple schema fields    | Display complete original object.                                                                      |
| Duplicate payload keys or noncanonical escapes | Display original text.                                                                                 |
| Non-string property or value                   | Display original text.                                                                                 |
| Exact intermediate block before a tool row     | Display the string value without joining across the tool boundary.                                     |
| Nested loop-group node                         | Use the matched nested definition schema.                                                              |
| Historical row with matching current schema    | Project without changing storage.                                                                      |
| Definition changed or deleted                  | Fail closed to original text.                                                                          |
| E2E fake default scenario                      | Preserve the existing deterministic response while the opt-in report scenario emits structured output. |

## Risks and controls

- Current definitions can reinterpret a matching historical row, so exact schema and payload equality minimize the risk and missing definitions fail closed.
- Transforming before delta assembly can parse incomplete JSON, so call order is an explicit unit assertion.
- Wiring only selected rooms leaves Console inline history inconsistent, so all three production call sites have component and browser coverage.
- Console selection suspends inline history, so the browser test asserts inline output before selection and then scopes selected-room assertions to the opened room.
- Generic multi-field formatting can hide data, so it remains out of scope.

## Security considerations

Use `JSON.parse()` only on already stored transcript text in the browser.
Do not use `eval`, repair malformed JSON, inject HTML, or bypass the existing Markdown sanitization path.

## Regression Gate

- [ ] RED tests prove current raw wrapper display in every production mount.
- [ ] Exact-match unit matrix passes without mutating input rows.
- [ ] Duplicate-key and noncanonical raw JSON fail closed.
- [ ] Node output and downstream field references remain structured and unchanged.
- [ ] The fake provider capability and comment match its implemented opt-in structured-output contract.
- [ ] Tool rows, Raw payloads, occurrence navigation, saved scroll state, and Markdown rendering stay green.
- [ ] The isolated browser proof uses the real server, API, database, workflow executor, and built Web target.

## Todo

- [ ] Add the shared RED projection matrix.
- [ ] Add Legacy and both Console wiring tests.
- [ ] Add the deterministic workflow, strict fake scenario, and browser reproduction.
- [ ] Align the fake provider capability and comment with the implemented scenario.
- [ ] Implement the shared exact-match projection and caller wiring.
- [ ] Run focused unit, component, provider, build, and browser gates.

## Success criteria

Readable report prose appears consistently in all three Web transcript mounts, while the API and engine still expose the original structured contract.

## Rollback

Remove the optional presentation input and caller wiring, fake-provider scenario and capability change, workflow fixture, runtime helper, and browser spec together to restore raw display without leaving unused test infrastructure.
