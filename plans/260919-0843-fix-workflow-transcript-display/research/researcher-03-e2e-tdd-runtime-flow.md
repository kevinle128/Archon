# TDD, runtime-flow, and browser E2E research

## Scope and conclusion

This report covers four accepted outcomes.

The first outcome is that a node with an `output_format` report displays the report prose instead of the serialized `{"report":"..."}` object.

The second outcome is that Devin ACP word or token chunks form one assistant message instead of one `ASSISTANT` row per chunk.

DeepSeek has the same ACP mapping defect and must receive the same contract correction.

The third outcome is that the Legacy Graph node room keeps all scrolling inside its intended bounds, including after the pointer exits the transcript scroll region.

The fourth outcome is that the Legacy runtime node graph has no minimap, while its controls, pan, zoom, node selection, and layout continue to work.

The Console runtime graph already has no minimap, so it needs regression proof but no minimap removal.

The smallest robust delivery has three tests-first phases and one final verification gate.

The engine output contract must not change.

## Evidence inspected

The repository is on `develop` at `81ba296f`, and that commit is also `origin/develop`.

The current branch contains the merged readable row change at `0fb1fd04`, the Raw change at `ea083109`, the occurrence navigation change at `81ba296f`, and the queue guidance change at `bd0816b2`.

The related plan front matter is not a reliable implementation-status source because the Issue 174, 175, 180, and 181 plan files still say `pending`, `todo`, or `in-progress` after their code and acceptance evidence merged.

The current source and the merge commits are the implementation authority for this work.

The historical transcript plans establish that transcript rows are immutable, ordered, and appended as provider chunks arrive.

The current node-room specification requires equivalent Legacy and Console transcript meaning, keeps shared interpretation in `packages/web/src/lib/`, and forbids default serialized JSON presentation.

The current test plan requires both renderer families to remain covered and requires Console to keep its package-isolation boundary.

The `verify-archon` skill requires an exact built Web target, an isolated runtime, deterministic prepared data, complete functional proof, and required visual proof.

The current `ui.rooms` and `ui.visual` verifier scenarios do not state the new report, pointer-exit scroll, or minimap requirements.

A future implementation must update the verifier catalog or record the coverage gap before it claims governed visual proof.

## Current runtime diagnosis

### Structured report display

`packages/workflows/src/dag-executor.ts` appends each assistant chunk to the node transcript before the final result chunk arrives.

When `output_format` is present and the final structured output is valid, the executor still replaces `nodeOutputText` with the structured value or its JSON serialization.

The executor uses that structured value for downstream field references and for the final batch platform message.

The persisted assistant transcript therefore correctly contains the provider's streamed JSON text, while the node result correctly remains structured engine data.

The defect is a Web presentation defect, and changing `nodeOutputText` to the `report` string would break `$node.output.report` and bare `$node.output` behavior.

`packages/web/src/lib/project-text-transcript.ts` first projects deltas and snapshots into complete text blocks.

`packages/web/src/lib/agent-history.ts` then maps every projected text block directly to an assistant item without knowing the selected node's `output_format`.

The safe repair seam is an optional node output-format input at the shared `buildAgentHistory()` projection boundary.

The projection must unwrap only a schema-declared top-level string `report` from a valid object and must preserve the raw text for an absent schema, malformed JSON, a non-object value, a missing report, or a non-string report.

The projection must run after text-delta assembly so fragmented JSON is parsed only after it is complete.

### ACP assistant chunks

`packages/providers/src/community/devin/event-bridge.ts` maps ACP `agent_message_chunk` updates to assistant chunks without `textMode`.

`packages/providers/src/community/deepseek/event-bridge.ts` has the same mapping.

Both ACP clients concatenate those chunks into a local transcript for structured-output parsing, so the upstream protocol meaning is already known to be incremental text.

`packages/providers/src/types.ts` already permits `textMode: 'delta'`, and the Copilot ACP bridge already uses that value for incremental message updates.

The provider repair does not need a public type or engine signature change.

Both direct-agent and loop-agent paths in `packages/workflows/src/dag-executor.ts` already copy `textMode` to persisted `metadata.text_mode` without changing `nodeOutputText` accumulation.

The Web text projector already merges adjacent anonymous deltas within one occurrence and attempt.

The cause-aligned repair is therefore to mark Devin and DeepSeek ACP `agent_message_chunk` output as `textMode: 'delta'`.

### Legacy scroll ownership

`packages/web/src/components/workflows/NodeTranscriptPane.tsx` makes `data-testid="node-transcript-scroll"` the intended vertical scroll owner.

`packages/web/src/lib/room-scroll-follow.ts` only manages follow and saved-scroll state and does not own wheel events.

`packages/web/src/components/workflows/WorkflowExecution.tsx` contains the visible run header and tabs inside `legacy-run-view`.

`packages/web/src/components/workflows/LegacyNodeRoom.tsx` contains the room header above the transcript region.

`packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` supplies the split panels, but its `legacy-run-room` `PercentResizablePanel` does not currently carry the flex and `min-h-0` class contract used by the view panel.

`packages/web/src/components/layout/Layout.tsx` uses a fixed `h-screen` wrapper, but the wrapper does not hide overflow and its `main` element does not declare `min-h-0`.

`packages/web/src/index.css` does not lock `html`, `body`, or `#root` scrolling.

When the pointer is inside the transcript, `node-transcript-scroll` is the intended owner.

When the pointer exits that scroll region, the user-observed escaped owner is `document.scrollingElement`, which moves the run header and room header and exposes the blank overflow below the run.

Adding only `overscroll-behavior` to the transcript cannot fix the clarified pointer-exit trigger because the wheel event is then targeted outside that element.

The red browser measurement must decide the smallest root containment change among the Legacy layout wrapper, `main`, the room panel, and the inner scroller.

The completed repair must make the document non-scrollable on this route, keep the split panels shrinkable, and contain boundary wheel input while the pointer remains over the transcript.

### Runtime graph minimap ownership

`packages/web/src/components/workflows/WorkflowDagViewer.tsx` is the Legacy runtime graph owner and renders React Flow `Controls` and `MiniMap`.

`packages/web/src/components/workflows/WorkflowExecution.tsx` is its only production caller.

`packages/web/src/experiments/console/components/RunGraphPanel.tsx` is the Console runtime graph owner and has no minimap.

The Console graph has its own Zoom out, Zoom in, and Fit controls, a native overflow scroller for pan, stable node buttons, and shared run-graph layout geometry.

`packages/web/src/components/workflows/WorkflowCanvas.tsx` and `packages/web/src/experiments/console/builder/components/BuilderCanvas.tsx` also render minimaps, but those files own workflow builders rather than the pictured runtime node graph.

The requested removal should therefore remove the minimap only from `WorkflowDagViewer.tsx` unless the owner separately expands the request to workflow builders.

## Runtime-flow proof rows

| Proof row                       | Input and boundary                                                                                                                             | Expected stored or engine state                                                                                                                   | Expected observable UI                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ACP delta contract              | Devin and DeepSeek receive two ACP `agent_message_chunk` text updates.                                                                         | Both bridges emit two assistant chunks with `textMode: 'delta'`, and their clients still parse the concatenated transcript for structured output. | The provider boundary no longer describes each word as a complete assistant message.                                            |
| Executor persistence            | A provider yields two assistant deltas and one result chunk.                                                                                   | The store has two ordered text rows with `metadata.text_mode === 'delta'`, and node output is the exact concatenation.                            | The Web projector has enough metadata to form one assistant item.                                                               |
| Structured result semantics     | A node streams fragmented `{"report":"Readable report"}` and returns `structuredOutput: { report: 'Readable report' }`.                        | The node result remains the serialized structured object, and `$node.output.report` resolves to `Readable report`.                                | The selected room shows only the report prose and not the serialized object.                                                    |
| Projection fail-closed behavior | The selected definition has no declared string report, or the assistant text is malformed or has the wrong shape.                              | No engine state changes.                                                                                                                          | The original assistant text remains visible and is not deleted or guessed.                                                      |
| Legacy in-pane scroll           | A long transcript is open and the pointer is over `node-transcript-scroll`.                                                                    | Only the inner `scrollTop` changes until the last row is reachable.                                                                               | The run header, room header, split geometry, and document scroll position remain fixed.                                         |
| Legacy pointer-exit scroll      | The transcript is at its boundary, the pointer moves to the room header or another non-scrollable Legacy pane area, and the user wheels again. | `document.scrollingElement.scrollTop` stays zero and its scroll height does not exceed its client height beyond rounding.                         | No header moves and no blank document region appears below the transcript.                                                      |
| Legacy runtime graph            | The Graph tab opens after minimap removal.                                                                                                     | The same DAG view model and node positions are used.                                                                                              | No `.react-flow__minimap` exists, controls remain visible, zoom and pan change the viewport, and node selection opens the room. |
| Console runtime graph           | The Console Graph view opens.                                                                                                                  | The Console SVG/HTML model and geometry are unchanged.                                                                                            | No minimap exists, Zoom out, Zoom in, and Fit work, the scroller pans, and node selection opens the room.                       |

## Smallest tests-first phase structure

### Phase 1: Add deterministic reproduction and RED contracts

Add a deterministic E2E fixture and fake-provider scenario before changing production display or layout behavior.

Use `e2e/fixtures/workflows/e2e-transcript-display.yaml` for one report producer, one downstream consumer, and one long-history node.

Extend `packages/providers/src/e2e-fake/provider.ts` with one narrow fixed structured-report scenario instead of arbitrary response scripting.

The scenario should emit at least three assistant chunks with `textMode: 'delta'`, whose exact concatenation is `{"report":"E2E readable report"}`, and then emit `structuredOutput: { report: 'E2E readable report' }` on the result.

Add a provider test in `packages/providers/src/e2e-fake/provider.test.ts` that proves the fixed chunk order, delta metadata, structured result, and rejection when the scenario is used without the expected output-format request.

Seed the fixture in `e2e/lib/playwright/archon-runtime.ts` and add `runTranscriptDisplayWorkflow()` plus stable workflow and node constants.

Add `e2e/ui/workflow-transcript-display.spec.ts` and first record the current failures for serialized report display, pointer-exit document scrolling, and the Legacy minimap.

The ACP cause gets its exact RED proof in the provider unit tests because the browser runtime intentionally uses the deterministic fake rather than a live Devin or DeepSeek service.

### Phase 2: Repair provider and shared transcript projection contracts

Change the Devin and DeepSeek event bridges only after their unit assertions fail for missing delta metadata.

Add executor transcript tests that prove the metadata persists through the real store boundary and that structured node output and downstream field references do not change.

Add shared Web projection tests that prove delta assembly, schema-directed report display, and fail-closed fallbacks.

Thread the optional output format through all three production `buildAgentHistory()` call sites before changing either renderer's markup.

Run the pure and component tests after each contract becomes green.

### Phase 3: Repair Legacy containment and remove the runtime minimap

Use the Phase 1 browser measurements to change the smallest containment chain that keeps the document fixed for both in-pane and pointer-exit wheel input.

Keep the transcript scroller as the only room body scroll owner and preserve occurrence navigation, follow mode, the todo strip, Ask cards, and the queue composer sibling layout.

Remove the Legacy runtime `MiniMap` import, element, and minimap-only color code from `WorkflowDagViewer.tsx`.

Do not change the Console runtime graph and do not change either workflow builder.

Make the Legacy and Console graph interaction tests green before the browser test is accepted.

### Phase 4: Broaden validation and governed verification

Run package-isolated suites, the E2E type check, the focused browser spec, and `bun run validate`.

Update the `verify-archon` run-UI catalog or scenario configuration for the new requirements, create a fresh explicit selection, and run governed proof without editing old evidence.

## Test scenario matrix

| ID   | Layer                                    | Scenario                                                                                               | Required assertions                                                                                                           |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| P-1  | Devin event bridge                       | Two text `agent_message_chunk` updates arrive.                                                         | Each maps to an assistant chunk with `textMode: 'delta'`, and order and content are unchanged.                                |
| P-2  | DeepSeek event bridge                    | Two text `agent_message_chunk` updates arrive.                                                         | Each maps to an assistant chunk with `textMode: 'delta'`, and order and content are unchanged.                                |
| P-3  | Both ACP clients                         | A fragmented JSON reply is used with an output schema.                                                 | Emitted assistant chunks remain deltas, and the final result still contains the parsed structured object.                     |
| W-1  | Workflow executor                        | Two assistant deltas precede a structured result.                                                      | Two stored rows keep delta metadata, node output stays concatenated or structured as applicable, and no row is dropped.       |
| W-2  | Workflow executor                        | A report producer feeds `$producer.output.report` to a consumer.                                       | The consumer receives the report string, while bare producer output remains the structured JSON serialization.                |
| UI-1 | Text projection                          | Anonymous deltas share one occurrence and attempt.                                                     | One projected text block is produced with the first row's stable identity.                                                    |
| UI-2 | Agent history                            | The output schema declares a top-level string report and text is valid report JSON.                    | One assistant item contains report prose only.                                                                                |
| UI-3 | Agent history                            | JSON is fragmented across deltas.                                                                      | Projection assembles first and unwraps second.                                                                                |
| UI-4 | Agent history                            | The schema is absent or the JSON is malformed, non-object, missing report, or has a non-string report. | The original text remains unchanged.                                                                                          |
| UI-5 | Occurrence compatibility                 | Two executions use the same stream identifiers.                                                        | Rows do not merge across occurrence or attempt boundaries, and grouping and navigation remain unchanged.                      |
| UI-6 | Legacy room                              | A selected report node renders after paging.                                                           | The prose is visible, serialized report syntax is absent, and there is one `ASSISTANT` row.                                   |
| UI-7 | Console selected room and inline history | The same selected report node renders in both Console mounts.                                          | Both mounts use the same prose projection and do not duplicate chunk rows within one mount.                                   |
| S-1  | Legacy component layout                  | The node room contains its header, todo or dock siblings, and transcript.                              | The panel chain has a shrinkable bounded contract and only the transcript body has vertical auto-scroll.                      |
| S-2  | Browser scroll                           | The pointer is over the transcript and wheels to the bottom.                                           | The inner scroll changes, the last row is reachable, headers and panel rectangles stay fixed, and the document stays at zero. |
| S-3  | Browser pointer exit                     | The pointer moves from the transcript to the room header and wheels at the transcript boundary.        | The document still does not move, header rectangles remain fixed, and no blank region becomes reachable.                      |
| G-1  | Legacy graph component                   | The runtime graph renders.                                                                             | The minimap is absent, React Flow controls remain, and the same node view model renders.                                      |
| G-2  | Console graph component                  | The runtime graph renders.                                                                             | No minimap exists, all three controls remain, canvas scale changes, native pan works, and selection callbacks fire.           |
| G-3  | Browser graph parity                     | Each runtime graph opens from the real run.                                                            | Minimap absence, zoom, pan, fit where supported, non-overlapping node boxes, and room-opening selection all pass.             |

## Exact contract and caller inventory

### Provider metadata contract

`MessageChunk` in `packages/providers/src/types.ts` already contains optional `textMode`, so no signature change is required.

The changed producers are `mapDevinSessionUpdate()` and `mapDeepseekSessionUpdate()`.

The direct executor consumer is the assistant branch near `packages/workflows/src/dag-executor.ts:2350`.

The loop executor consumer is the assistant branch near `packages/workflows/src/dag-executor.ts:6060`.

The browser consumer is `projectTextTranscript()` in `packages/web/src/lib/project-text-transcript.ts`.

Existing tests with exact assistant-chunk equality in both ACP event-bridge and ACP-client suites must be updated to include `textMode: 'delta'`.

### Shared report-presentation input

The proposed internal signature change is an optional `outputFormat?: Record<string, unknown>` on `AgentHistoryInput`.

The three production callers of `buildAgentHistory()` are `packages/web/src/components/workflows/NodeTranscriptPane.tsx`, `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`, and `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`.

`LegacyNodeRoom.tsx` already resolves the selected definition node and should pass its `output_format` through a new optional `NodeTranscriptPane` prop.

`ConsoleNodeRoom.tsx` already resolves the selected definition node and can pass its `output_format` directly.

`ConsoleInspectPane.tsx` owns the definition-node list for inline `ConsoleExecutionHistory` instances and must pass the matching definition node's `output_format` through a new optional prop.

All added props must stay optional so missing or failed workflow-definition loads preserve current raw transcript behavior.

The Web package must continue to use the generated `DagNode` type and must not import from `@archon/workflows`.

### Layout and graph contracts

`Layout.tsx`, `WorkflowExecution.tsx`, `LegacyGraphLogsPane.tsx`, `LegacyNodeRoom.tsx`, and `NodeTranscriptPane.tsx` form the Legacy vertical containment chain.

`room-scroll-follow.ts` is a state helper and should not change unless the browser evidence shows a follow-state regression.

`WorkflowDagViewer.tsx` has one production caller in `WorkflowExecution.tsx`.

`RunGraphPanel.tsx` has one production caller in `ConsoleInspectPane.tsx`.

No public API, database, workflow YAML, generated type, or provider interface change is required for the product fixes.

The E2E fixture and fake-provider scenario are test-only contracts.

## Browser E2E runtime boundary

Use the existing worker-scoped runtime in `e2e/lib/playwright/suite.ts` and `e2e/lib/playwright/archon-runtime.ts`.

The runtime must build and serve the exact target Web UI, use its fresh temporary `ARCHON_HOME`, use its own SQLite database, and use its deterministic per-worker port.

The only allowed external behavior substitute is the env-gated in-process `e2e-fake` provider at the provider boundary.

Do not use `page.route()` or fixture HTML as the proof for transcript semantics, node output, scroll ownership, or graph behavior.

Normal identity headers and the runtime's authenticated fetch helper are part of the existing harness and are allowed.

No vendor credentials, network model call, shared user database, or pre-existing run may be required.

The fixture producer must declare this output format.

```yaml
output_format:
  type: object
  properties:
    report:
      type: string
  required: [report]
  additionalProperties: false
```

The fixture consumer must include `$report-node.output.report` in its prompt and use the existing fake `echoPrompt` behavior.

The browser must assert the consumer transcript contains `E2E readable report`, which proves that the engine retained structured field semantics.

The browser must also fetch the producer's node messages and assert that more than one stored text row has `metadata.text_mode === 'delta'` while the scoped room has exactly one assistant history row for that response.

### Legacy scroll assertions

Run the scroll proof at 1440 by 1000 with the existing long-history fixture or an equivalent long node in the new fixture.

Open the Legacy run, select Graph, select the long-history node, and wait until all expected history rows are loaded.

Capture `document.scrollingElement.scrollTop`, `scrollHeight`, and `clientHeight` before wheel input.

Capture bounding rectangles for the Legacy run header, run tabs, room header, room panel, and transcript scroller.

Hover the transcript scroller and send positive wheel input until `abs(scrollHeight - clientHeight - scrollTop) <= 2`.

Assert that the last expected transcript item is visible and its bottom edge is no lower than the scroller bottom edge plus two pixels.

Assert that the run header, run tabs, room header, and room panel rectangles have not moved by more than two pixels.

Assert that `document.scrollingElement.scrollTop` remains zero.

Move the pointer to the visible room header, which is outside `node-transcript-scroll`, and send more positive wheel input.

Repeat the document and geometry assertions after that exact pointer-exit trigger.

Move the pointer to a non-node area of the graph pane and repeat the document assertion while permitting the graph's own zoom behavior.

Finally, assert `document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight + 2` so a hidden blank document region cannot pass.

### Graph assertions

On Legacy, assert that `.react-flow__minimap` has count zero and `.react-flow__controls` is visible.

Click Zoom in and Zoom out and assert that the `.react-flow__viewport` transform changes and then moves in the expected direction.

Drag a blank `.react-flow__pane` area and assert that the viewport translation changes without changing the document scroll position.

Click a known `.react-flow__node[data-id]` and assert that the matching Legacy node room opens.

On Console, assert that `.react-flow__minimap` has count zero and that Zoom out, Zoom in, and Fit are visible.

Click the Console zoom controls and assert that `console-run-graph-canvas` changes scale.

Create overflow with zoom when necessary, wheel or scroll `console-run-graph-scroller`, and assert its `scrollTop` or `scrollLeft` changes while the document stays fixed.

Click a `data-node-id` button and assert that the matching Console room opens.

For both surfaces, collect visible node rectangles and assert that distinct nodes do not overlap and that at least one complete node remains visible after Fit.

Do not use exact pixel coordinates as a layout contract.

## Exact test files

Modify `packages/providers/src/community/devin/event-bridge.test.ts` for the primary ACP delta contract.

Modify `packages/providers/src/community/devin/acp-client.test.ts` for end-to-end ACP turn collection and structured-output preservation.

Modify `packages/providers/src/community/deepseek/event-bridge.test.ts` for parity.

Modify `packages/providers/src/community/deepseek/acp-client.test.ts` for parity and structured-output preservation.

Modify `packages/providers/src/e2e-fake/provider.test.ts` for the deterministic browser scenario.

Modify `packages/workflows/src/dag-executor.test.ts` for transcript metadata and unchanged structured-output and downstream-reference semantics.

Modify `packages/web/src/lib/project-text-transcript.test.ts` for fragmented delta and execution-boundary behavior.

Modify `packages/web/src/lib/agent-history.test.ts` for schema-directed report display and fail-closed cases.

Modify `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx` for output-format plumbing and the inner scroll-owner contract.

Modify `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx` for Legacy report rendering.

Modify `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` for split-panel containment.

Modify `packages/web/src/components/workflows/WorkflowExecution.test.tsx` for the Legacy runtime graph minimap and controls regression.

Add `packages/web/src/components/layout/Layout.test.tsx` only if the measured repair changes the root Legacy layout contract.

Modify `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` for Console selected-room report rendering.

Modify `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` for the inline Console mount.

Modify `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx` for explicit minimap absence and retained control, pan, selection, and layout behavior.

Add `e2e/fixtures/workflows/e2e-transcript-display.yaml` and `e2e/ui/workflow-transcript-display.spec.ts`.

Modify `e2e/lib/playwright/archon-runtime.ts` only to seed and run that deterministic fixture.

## Exact commands and isolation rules

Run provider test files as separate Bun processes because the provider package deliberately isolates tests that use `mock.module()`.

```bash
cd packages/providers
bun test src/community/devin/event-bridge.test.ts
bun test src/community/devin/acp-client.test.ts
bun test src/community/deepseek/event-bridge.test.ts
bun test src/community/deepseek/acp-client.test.ts
bun test src/e2e-fake/provider.test.ts
```

Run the workflow executor file in the workflows package process.

```bash
cd packages/workflows
bun test src/dag-executor.test.ts
```

Run pure Web tests separately from Legacy component tests and Console tests, which matches the Web package script's isolation boundaries.

```bash
cd packages/web
bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts
NODE_ENV=development bun test src/components/layout/Layout.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/WorkflowExecution.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/components/RunGraphPanel.test.tsx src/experiments/console/console-isolation.test.ts
```

Omit `Layout.test.tsx` from the focused command if the measured fix does not create that file.

Build the exact Web target before Playwright, then run the standalone E2E package from its own directory.

```bash
bun run build:web
cd e2e
npm run typecheck
npx playwright test -c playwright.config.ts ui/workflow-transcript-display.spec.ts
```

Run package gates and the repository gate after the focused tests.

```bash
bun run --cwd packages/providers test
bun run --cwd packages/workflows test
bun run --cwd packages/web test
bun run type-check
bun run validate
```

Never run `bun test` from the repository root because Bun's process-wide module mock cache causes cross-package pollution.

`bun run test` is the correct root full-test command because it invokes package tests in isolated package processes.

## Cross-plan dependency classification

| Plan                                                                    | Current merged behavior                                                      | Classification for this work                       | Required action                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue 174 readable tool row                                             | Merged in `0fb1fd04` with shared history projection and both room renderers. | Compatible prerequisite.                           | Preserve tool rows, output loading, and renderer parity; do not update the old plan.                                                               |
| Issue 175 Raw payload toggle                                            | Merged in `ea083109` with Raw restricted to tool payloads.                   | Compatible prerequisite.                           | Do not route assistant report JSON through the tool Raw control; do not update the old plan.                                                       |
| Issue 180 occurrence navigation                                         | Merged in `81ba296f` despite `in-progress` plan metadata.                    | Direct code overlap and regression dependency.     | Preserve execution-scoped delta separation, grouping, navigator focus, saved scroll, and follow state; do not update the old plan.                 |
| Issue 181 queue guidance                                                | Merged in `bd0816b2` despite `pending` plan metadata.                        | Direct layout and E2E-harness overlap.             | Preserve the composer as a non-scrolling sibling and extend the strict fake scenario without weakening its validation; do not update the old plan. |
| Issue 176 family bodies, Issue 179 todo strip, and Issue 178 task cards | Their current Web behavior is merged on `develop`.                           | Adjacent renderer and geometry regression surface. | Keep their existing tests green; no plan dependency or prior-plan update is needed.                                                                |

No prior plan must be edited.

The new plan should record that the related plan status fields are stale historical metadata and should cite the merge commits above.

The new plan has a code-order dependency on the already-merged occurrence and queue behavior because it changes the same projector, scroller, and test provider seams.

It does not have a release or branch dependency on unfinished prior plan files.

## Rollback and failure signals

The provider change can be rolled back independently by reverting the two ACP bridge mappings if it causes a verified upstream contract mismatch.

A provider rollback signal is a structured-output parse regression, changed chunk order or content, or a provider client test that no longer collects the same concatenated transcript.

The report-display change can be rolled back independently because its input is optional and Web-only.

A report-display rollback signal is any change to node output, downstream field substitution, non-report assistant prose, malformed-text visibility, item identity, occurrence grouping, or tool Raw behavior.

The scroll containment change can be rolled back independently from transcript interpretation and graph minimap removal.

A scroll rollback signal is a clipped run header, an unreachable transcript tail, a hidden Ask card or composer, broken occurrence navigation, a room resize regression, a changed Console layout, or any nonzero document scroll during the pointer-exit E2E case.

The minimap removal can be rolled back independently by restoring only the Legacy `MiniMap` element and its minimap-only imports and constants.

A minimap rollback signal is loss of zoom controls, pan, fit, node selection, usable node layout, or keyboard focus behavior.

The E2E fake and fixture must be reverted with any implementation rollback so the harness does not claim a product contract that the target no longer has.

## Risks and unresolved questions

The phrase “report JSON” can mean any object with a `report` key or only a node whose schema declares a string report.

This report recommends the schema-directed interpretation because it is deterministic and prevents accidental unwrapping of ordinary JSON prose.

When the workflow definition is unavailable, the optional contract should fail closed to the current raw assistant text unless the owner accepts a separate server projection.

The browser E2E cannot prove the real Devin binary without external credentials and network state.

The paired Devin and DeepSeek ACP unit tests prove the real adapter boundary, while the deterministic browser runtime proves the shared executor, persistence, API, and UI path.

The exact Legacy containment edit must remain evidence-driven until the RED browser test records which ancestor first exceeds the viewport.

The required acceptance invariant is not conditional: after the repair, `document.scrollingElement` must not own vertical scrolling on the Legacy run route, including after the pointer exits the transcript.

The builder minimaps are outside the pictured runtime graph scope.

If the owner intends to remove minimaps from workflow builders too, that is a separate accepted scope expansion with separate builder interaction tests.

## Acceptance recommendation

Accept the implementation only when all four outcomes pass in the real isolated browser runtime, the ACP adapter suites pass for Devin and DeepSeek, the executor proves unchanged structured semantics, both Web shells pass, and the repository validation gate is green.

Do not accept a screenshot-only result, a route-mocked transcript, a DOM-only hidden JSON check, or a scroll test that keeps the pointer inside the transcript for the full case.
