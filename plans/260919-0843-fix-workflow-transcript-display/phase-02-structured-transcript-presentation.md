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

Legacy, the Console selected room, and Console inline history display the Markdown string from an exact schema-declared one-string JSON envelope. The durable assistant text, API response, structured node result, and downstream field references remain unchanged.

## Context and authority

- [Structured-output presentation research](./research/researcher-01-structured-output-presentation.md)
- [Runtime-flow and E2E research](./research/researcher-03-e2e-tdd-runtime-flow.md)
- `_bmad-output/specs/spec-agent-node-room/SPEC.md` is the canonical node-room contract; its `sources/` specs are absorbed and superseded.
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` and `EXPERIENCE.md` are final adopted companions named by the canonical contract.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/` confirms the existing room hierarchy and graph controls but does not override the canonical node-room contract.

The specification's broad prohibition on default raw serialized JSON conflicts with issue 208's byte-preserving fallback for unclassifiable assistant text. Update the specification with the narrow resolved rule described in the parent plan before implementing presentation. If that authority change is not accepted, stop Phase 2 and escalate the conflict; do not silently choose a different fallback.

## Requirements

- Add optional `outputFormat?: Record<string, unknown>` presentation context to `AgentHistoryInput`.
- Run the display transform after `projectTextTranscript()`, independently for each projected text item. Tool rows remain boundaries.
- Qualify a schema only when it is a non-array record with `type === 'object'`, `properties` is a non-array record with exactly one own key, and that property is a non-array record whose `type === 'string'`. Other property annotations or constraints do not disqualify it.
- Qualify text only when the entire string parses as a non-null, non-array object with exactly the declared own key and a string value.
- Require `rawText === JSON.stringify(parsed)`. This rejects whitespace variants, duplicate keys, alternate escaping, and other normalizing parses.
- On success, copy only the string value into the projected history item. On any failed guard or parse error, return the original text byte-for-byte.
- Never mutate the input rows or alter history item IDs, sequence, execution identity, occurrence, attempt, timestamps, tool items, or status.
- Wire the schema from the matched definition node to all three production mounts, including nested loop-group definitions.
- While a definition is missing or loading, render original history; rerender after it resolves. Do not hide the transcript or guess from node output.
- Keep persisted rows, API output, Markdown components, raw-HTML policy, engine structured result, and downstream `$node.output.field` behavior unchanged.
- Do not change the E2E fake provider or its `structuredOutput` capability. The declared capability type is `'enforced' | 'best-effort' | false`, not a boolean `true`, and a test-only scenario does not justify a provider-wide contract.

## Architecture

`buildAgentHistory()` remains the shared, render-neutral presentation seam. Legacy obtains its matched definition through `LegacyNodeRoom` and forwards `definitionNode?.output_format` through `NodeTranscriptPane`. `ConsoleNodeRoom` already owns the selected definition. `ConsoleInspectPane` must use its existing nested definition-node resolution to pass the schema into each inline `ConsoleExecutionHistory`. Both final renderers retain their existing ReactMarkdown configuration and link handling; no JSON-specific React component is added.

## Files

| File                                                                                       | Action       | Change                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/agent-history.test.ts`                                               | Modify first | Add the schema/payload matrix, delta-before-unwrap ordering, per-block behavior, byte preservation, and immutability assertions.                                     |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                            | Modify first | Prove Legacy schema forwarding, readable Markdown, and fail-closed fallback.                                                                                         |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Modify first | Prove selected-room parity.                                                                                                                                          |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Modify first | Prove inline-history parity.                                                                                                                                         |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx`              | Modify first | Prove definition loading and nested-node schema forwarding.                                                                                                          |
| `packages/workflows/src/dag-executor.test.ts`                                              | Modify first | Prove a structured result remains an object and a downstream node receives `$producer.output.report` unchanged.                                                      |
| `e2e/fixtures/workflows/e2e-transcript-display.yaml`                                       | Create first | Add a deterministic workflow with a bash anchor and conditionally skipped exact/fallback report nodes that declare the one-string schema; no AI call occurs.         |
| `e2e/ui/workflow-transcript-display.spec.ts`                                               | Create first | Use the isolated prepared run to prove the real definition/API/Web boundary in all three mounts.                                                                     |
| `packages/web/src/lib/agent-history.ts`                                                    | Modify       | Add the optional input and exact local presentation helper.                                                                                                          |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                             | Modify       | Accept and forward optional output format.                                                                                                                           |
| `packages/web/src/components/workflows/LegacyNodeRoom.tsx`                                 | Modify       | Supply the matched definition schema.                                                                                                                                |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                      | Modify       | Supply the selected definition schema.                                                                                                                               |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`      | Modify       | Accept and forward optional output format.                                                                                                                           |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`                   | Modify       | Resolve and forward nested definition schemas for inline history.                                                                                                    |
| `e2e/lib/playwright/archon-runtime.ts`                                                     | Modify       | Copy/run the fixture and expose one domain-specific helper that seeds exact fragments, fallback text, execution metadata, and lifecycle events for both test owners. |
| `_bmad-output/specs/spec-agent-node-room/SPEC.md`                                          | Modify       | Reconcile the canonical presentation rule and list exact/fallback states.                                                                                            |

## Tests Before

1. Add unit cases that expose the current raw wrapper for an exact one-string schema and verify the current projector assembles deltas first.
2. Add caller tests that fail when Legacy, Console selected, or Console inline history omits the definition schema.
3. Add executor proof for the engine contract independently of the browser fixture: the structured node output remains `{ report: string }` and a downstream `$producer.output.report` reference receives the string.
4. Add a workflow fixture whose bash anchor completes and whose exact/fallback report nodes are skipped by deterministic `when:` conditions before provider resolution. Run it to create a real run/definition, then seed canonical fragmented report rows, an ineligible fallback row, execution metadata, and lifecycle events into its isolated SQLite database using the established occurrence-navigation pattern.
5. Confirm the browser currently displays the serialized wrapper. Fetch the node-message API and assert the original fragments, order, and execution metadata remain exact; their projected concatenation is the canonical JSON object.
6. Seed ineligible cases needed for browser fallback proof; keep the exhaustive malformed/duplicate/noncanonical matrix in the unit suite.

## Implementation steps

1. Implement a small local helper in `agent-history.ts` that inspects the optional schema and one projected text item.
2. Use own-key checks and explicit non-null/non-array object checks for both schema and payload; catch parsing failure and return the original string.
3. Enforce canonical equality before returning the property's string value.
4. Map projected text items to copies only when needed, preserving every field other than qualifying `text` and leaving inputs immutable.
5. Add optional prop plumbing through Legacy and both Console owners. Reuse the shell's existing definition resolver; do not create a second recursive walker.
6. Keep original history visible during definition loading and for missing/deleted definitions.
7. Update the canonical specification with the resolved exact-match/fail-closed rule and the three production surfaces.
8. Complete the real-server browser assertions without modifying provider capabilities or pretending seeded data proves provider streaming. Keep the seed operation as one narrow `prepareTranscriptDisplayRun()`-style harness method because the functional spec and governed visual capture both consume the same state; do not expose a generic database seeding API.

## Decision matrix

| Schema or text                                                                                                   | Display                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| One property whose schema has `type: 'string'` plus annotations/constraints; exact canonical one-key payload     | String value rendered by the existing Markdown component.        |
| Text assembled from compatible deltas into that exact payload                                                    | Assemble first, then unwrap once.                                |
| Matching intermediate block separated from another block by a tool row                                           | Transform that block independently; do not join across the tool. |
| Missing/loading/deleted definition or absent `output_format`                                                     | Original text.                                                   |
| Top-level schema not object, missing/invalid `properties`, zero/multiple properties, or property type not string | Original text.                                                   |
| Malformed, fenced, prose-wrapped, array, primitive, null, missing/extra-key, or non-string payload               | Original text.                                                   |
| Duplicate keys, whitespace variation, reordered/alternative escaping, or any parse/serialize normalization       | Original text.                                                   |
| Nested loop-group node with a resolved matching definition                                                       | Same exact rule as a top-level node.                             |

## Focused verification

```bash
(cd packages/web && bun test src/lib/agent-history.test.ts src/lib/project-text-transcript.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx)
(cd packages/workflows && bun test src/dag-executor.test.ts)
bun run build:web
(cd e2e && npm run typecheck && npx playwright test -c playwright.config.ts ui/workflow-transcript-display.spec.ts --grep 'transcript-display.structured')
```

Install the repository's locked dependencies before DOM suites; this checkout currently lacks `happy-dom`.

## Security, reliability, and performance

- Parse already stored display text with `JSON.parse()` only. Do not use evaluation, JSON repair, raw HTML, or a custom sanitizer.
- Fail closed on every ambiguity and preserve audit bytes. Existing ReactMarkdown behavior remains the only Markdown/URL policy.
- Parsing is linear in each projected assistant block and introduces no request, buffer, persistent state, or asymptotic change.
- Current definitions are not snapshotted, so an old canonical row may be interpreted under a changed schema. Record this residual risk; do not add migration or snapshot infrastructure to this fix.

## Regression gate

- [ ] RED tests cover the current wrapper in all three production mounts.
- [ ] The exact unit matrix passes, including annotations on string schemas, duplicate keys, noncanonical bytes, multiple tool-separated blocks, and input immutability.
- [ ] Definition loading and nested definitions fail closed and then rerender correctly.
- [ ] API rows retain their exact fragments, order, and execution metadata, and executor tests prove structured output/downstream references are unchanged.
- [ ] Tool rows, tool Raw disclosure, occurrence navigation, saved scroll, assistant Markdown, and link behavior stay green.
- [ ] The isolated browser proof uses the real server, SQLite, workflow definition, API, and built Web target and accurately labels seeded boundaries.
- [ ] The canonical specification matches the delivered exact/fallback behavior.

## Rollback

Remove the optional presentation input, caller wiring, tests/fixture, and specification clarification together to restore raw assistant display. No stored data or engine output requires rollback.
