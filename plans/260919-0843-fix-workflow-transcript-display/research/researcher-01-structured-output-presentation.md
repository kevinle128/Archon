# Structured-output transcript presentation research

## Summary

The raw JSON is durable assistant transcript text, not a React Markdown error and not an incorrect downstream node output.

The safest frontend-only change is an optional schema-aware display projection in `buildAgentHistory()` that unwraps only an exact one-field string object and returns the original text for every other case.

This change must reach three production callers: the Legacy selected room, the Console selected room, and the Console inline execution history.

The current workflow definition is the only frontend source of `output_format`, so the change can improve many historical runs but cannot give immutable historical semantics when a workflow definition changed or disappeared.

The connected Legacy scroll defect has a correct inner scroll owner but an incomplete outer containment chain, and the Legacy run graph minimap has one isolated owner with no Console run-view equivalent.

## Scope and method

This report is based on repository source at branch `develop` and commit `81ba296f` on 2026-09-19.

The investigation followed provider output, executor persistence, HTTP projection, workflow-definition loading, shared history projection, and both production render surfaces.

No source file, test file, configuration file, or generated file was changed.

## Verified findings

### The provider emits the structured payload as assistant text

`packages/providers/src/codex/provider.ts:369-408` builds a Codex turn schema from `requestOptions.outputFormat` or `nodeConfig.output_format` and records whether structured output was requested.

`packages/providers/src/codex/provider.ts:471-487` initializes one text accumulator for the turn.

`packages/providers/src/codex/provider.ts:628-635` treats every Codex `agent_message` as a normal complete assistant chunk and also keeps the last message as the structured-output candidate.

`packages/providers/src/codex/provider.ts:811-839` parses the candidate as JSON at turn completion and places the parsed value on the terminal `structuredOutput` field.

The Codex adapter therefore exposes the same model output twice with different contracts: raw text for the transcript and parsed data for the executor.

This mechanism is visible in Codex, but the frontend solution must stay provider-neutral because other adapters can also emit JSON text and a terminal structured value.

For example, `packages/providers/src/community/qodercli/provider.ts:484-490` emits stdout as assistant text, and `packages/providers/src/community/qodercli/provider.ts:514-526` parses the same stdout into `structuredOutput` when structured output was requested.

### The executor intentionally persists the raw assistant chunk

`packages/workflows/src/dag-executor.ts:2198-2200` keeps independent `nodeOutputText` and `structuredOutput` variables.

`packages/workflows/src/dag-executor.ts:2350-2363` writes every assistant chunk immediately as a durable node-transcript text row with `payload.text`, then also appends that text to `nodeOutputText`.

`packages/workflows/src/dag-executor.ts:2534-2595` reads the provider's terminal `structuredOutput` into the separate variable.

`packages/workflows/src/dag-executor.ts:3067-3114` validates structured output against the declared node schema and replaces only `nodeOutputText` with the validated structured value.

`packages/workflows/src/dag-executor.ts:3367-3375` records the normalized `nodeOutputText` as `node_completed.data.node_output`.

`packages/workflows/src/dag-executor.ts:3419-3433` returns normalized output, structured output, and declared fields for downstream workflow evaluation.

The validation and override happen after the raw assistant row is stored, so they do not and must not rewrite the transcript audit row.

This separation is correct for audit integrity and is the reason a frontend-only presentation fix is appropriate.

### The API returns text rows unchanged

`packages/server/src/routes/api.ts:1387-1405` defines the node transcript list route.

`packages/server/src/routes/api.ts:5399-5457` projects text-row payloads without transformation.

`packages/server/src/routes/api.ts:5460-5510` reads ordered transcript rows, applies cursor paging, and returns the projected rows.

`packages/web/src/lib/api.ts:700-730` exposes the generated node-message types and fetches this route.

No backend or API change is necessary for a display-only repair.

### The shared history projection is the correct presentation seam

`packages/web/src/lib/project-text-transcript.ts:61-125` joins deltas and replaces snapshots while preserving independent complete messages.

This projector has no node-definition or presentation knowledge, so it must remain unchanged.

`packages/web/src/lib/agent-history.ts:15-20` defines the render-neutral projection input.

`packages/web/src/lib/agent-history.ts:260-316` projects text and tool rows and currently copies `message.payload.text` unchanged into every assistant history item.

The raw JSON becomes visible assistant prose at `packages/web/src/lib/agent-history.ts:284-293`.

Repository search finds exactly three production calls to `buildAgentHistory()`.

The calls are `packages/web/src/components/workflows/NodeTranscriptPane.tsx:259-270`, `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:644-655`, and `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx:205-212`.

The prior readable-tool-row research reached the same ownership result at `plans/260917-1011-issue-174-readable-tool-call-row/research/research-synthesis.md:16-18`.

### Legacy already owns the matching definition node

`packages/web/src/components/workflows/resolve-room-kind.ts:39-52` finds top-level and nested loop-group nodes by qualified ID.

`packages/web/src/components/workflows/resolve-room-kind.ts:92-102` returns the matched `definitionNode` with the room kind.

`packages/web/src/components/workflows/LegacyNodeRoom.tsx:36-42` receives the workflow definition nodes.

`packages/web/src/components/workflows/LegacyNodeRoom.tsx:124-129` resolves the selected node and retains the matched definition node.

`packages/web/src/components/workflows/LegacyNodeRoom.tsx:173-194` mounts `NodeTranscriptPane` without the definition node or its `output_format`.

`packages/web/src/components/workflows/NodeTranscriptPane.tsx:78-97` has no structured-output presentation input.

Legacy therefore needs one optional `outputFormat` prop from `resolution.definitionNode?.output_format` through `NodeTranscriptPane` into `buildAgentHistory()`.

### Console has two separate history owners

`packages/web/src/experiments/console/components/ConsoleInspectPane.tsx:209-216` loads the current workflow definition and owns `definitionNodes` for the run inspector.

`packages/web/src/experiments/console/components/ConsoleInspectPane.tsx:263-285` mounts an independent `ConsoleExecutionHistory` for each inline log execution but does not pass definition data.

`packages/web/src/experiments/console/components/ConsoleInspectPane.tsx:307-347` also mounts the persistent selected-room `ConsoleNodeRoom` and already passes `definitionNodes` to it.

`packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:490-494` resolves the selected definition node.

`packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:644-655` builds selected-room history without its output schema.

`packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx:61-96` has no definition or output-schema prop.

`packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx:205-212` builds inline history independently.

`packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:182-203` renders assistant item text as Markdown.

`packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:857-919` serves both Console callers but does not own projection policy.

Passing `output_format` into the shared projection is sufficient for both renderers only if all three production projection calls receive it.

A change to only `LegacyNodeRoom` and `ConsoleNodeRoom` will leave the Console inline execution history broken.

The minimal Console wiring is to derive the matching definition in `ConsoleInspectPane` with the existing Console `resolveRoomKind()` helper and pass an optional `outputFormat` prop to `ConsoleExecutionHistory`.

This route reuses the nested-node lookup in `packages/web/src/experiments/console/components/inspect/resolve-room-kind.ts:43-56` instead of using an incorrect top-level-only `Array.find()`.

### The schema is already available in the web contract

`packages/workflows/src/schemas/dag-node.ts:193-205` accepts `output_format` as a free-form string-keyed record.

`packages/web/src/lib/api.generated.d.ts:4807-4820` generates `DagNode.output_format` as an optional record of unknown values.

`packages/web/src/lib/api.ts:10-30` exposes the generated DAG node type to Legacy without importing the workflows package.

The Console workflow skill exposes the same generated type at `packages/web/src/experiments/console/skills/workflows.ts:10-12`.

No generated type, server schema, or package boundary must change.

## Deterministic rendering rule

The shared projection must first complete text streaming with `projectTextTranscript()` and then apply the display rule to each projected complete assistant message.

The rule must run only when the selected node has an explicit `output_format` record.

The schema must declare `type: "object"` and an object-valued `properties` member.

The schema must declare exactly one top-level property.

That property schema must be a non-array object whose `type` is exactly `"string"`.

The assistant text must parse as JSON without repair, fence stripping, substring extraction, or prose scanning.

The parsed JSON must be a plain object and must contain exactly the one declared own key.

The matching value must be a string.

When all checks pass, the string value becomes `AgentHistoryItem.text` and keeps its Markdown meaning.

When any check fails, the original assistant text must be returned byte-for-byte for display.

The rule must not modify the input row, the stored payload, the message API response, the item ID, the sequence, or the execution scope.

This exact-match rule avoids parsing arbitrary natural language because a schema is a mandatory gate.

It also avoids treating JSON embedded in prose as a wire format because only the complete string can parse.

It prevents silent data loss because an extra payload key disables unwrapping.

It handles malformed JSON, arrays, primitives, null, malformed schemas, non-string fields, nested objects, and multi-field schemas with one lossless fallback.

The fallback can still look like raw JSON for complex structured outputs, but it remains complete and auditable instead of guessing which field a person intended to read.

If the product later requires readable multi-field structured output, it should add a dedicated structured-output history item with a complete key-and-value presentation and an explicit raw disclosure.

That larger design must not be hidden inside this bug fix.

## Approach comparison

### Approach A: Rewrite or suppress the persisted assistant row

This approach could make new runs look clean at the source.

It would weaken the audit trail, would not repair existing runs, and would couple persistence to provider-specific display behavior.

This approach is not recommended.

### Approach B: Parse JSON independently in each React renderer

This approach would avoid changing the shared history model.

It would duplicate policy between Legacy and Console and would still miss the Console inline history unless three rendering paths changed.

It would also make renderer behavior drift likely.

This approach is not recommended.

### Approach C: Convert every structured object to generic Markdown

This approach could remove JSON punctuation for all valid object schemas.

It creates unresolved policy for field order, nested values, arrays, booleans, null, labels, Markdown fields, and raw recovery.

It can hide information unless it introduces a new item model and raw disclosure.

This approach is too large for the defect and is not recommended now.

### Approach D: Apply one exact single-string unwrap in `buildAgentHistory()`

This approach changes display only, reaches both renderer families, keeps the audit row unchanged, and has a deterministic fallback.

It directly improves the common report-shaped schemas without inventing a generic schema renderer.

This approach is recommended.

## Evidence from real workflow schemas

`.archon/workflows/defaults/ak-implement.yaml:77-82` declares one string field named `plan_path`.

`.archon/workflows/defaults/ak-implement.yaml:211-216` declares one string field named `report`.

Both of these nodes can display the field value directly under the recommended rule.

`.archon/workflows/defaults/ak-implement.yaml:297-308` declares four fields with mixed string and number types.

`.archon/workflows/defaults/ak-implement.yaml:362-377` declares a multi-field loop status object.

`.archon/workflows/defaults/ak-implement.yaml:455-476` declares a six-field final review result.

These complex objects must remain complete under the lossless fallback until a separate structured-object presentation exists.

`packages/docs-web/src/content/docs/guides/loop-nodes.md:64-65` describes an `output_format` field as a structured completion channel.

`packages/docs-web/src/content/docs/guides/loop-nodes.md:340-350` states that the validated JSON is the loop output and that provider validation behavior is normalized.

The UI must use the declared schema as data and must not infer intent from the assistant prose.

## Historical-run behavior

The transcript table already contains the original text, so no data migration or backfill is needed.

The frontend can project old rows through the new rule as soon as it has a matching current workflow definition.

Legacy loads the current definition with `getWorkflow()` at `packages/web/src/components/workflows/WorkflowExecution.tsx:515-535` and passes the nodes into the graph and room at `packages/web/src/components/workflows/WorkflowExecution.tsx:1007-1030`.

Console loads the current definition with `getWorkflowDagNodes()` at `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx:209-216`.

The Legacy definition call uses `/api/workflows/:name` at `packages/web/src/lib/api.ts:798-806`.

The Console definition call uses the workflow list endpoint at `packages/web/src/experiments/console/skills/workflows.ts:100-111`.

No inspected workflow-run or transcript contract stores the workflow-definition snapshot that existed when the row was written.

If the workflow was deleted or cannot load, the schema is absent and the UI must keep the original text.

If the workflow changed its property name or shape, the exact-match rule usually falls back to the original text.

If a later definition adds the same one-string field name to a node whose old text happens to be an exact matching JSON object, the old row can be unwrapped even though the old run did not declare that schema.

This residual risk cannot be removed in a frontend-only change without an immutable definition snapshot or per-row structured-output metadata.

The exact key and shape checks minimize this historical reinterpretation risk.

## Runtime-flow proof

The browser runtime path for Legacy is current workflow definition fetch, `WorkflowExecution`, `LegacyGraphLogsPane`, `LegacyNodeRoom`, `NodeTranscriptPane`, node-message paging, `buildAgentHistory`, `NodeRoom`, and React Markdown.

The browser runtime path for the Console selected room is workflow-list definition fetch, `ConsoleInspectPane`, `ConsoleNodeRoom`, node-message paging, `buildAgentHistory`, `ConsoleAgentHistoryList`, and React Markdown.

The browser runtime path for Console inline history is workflow-list definition fetch, `ConsoleInspectPane.renderExecutionBody`, `ConsoleExecutionHistory`, node-message paging, `buildAgentHistory`, `ConsoleAgentHistoryList`, and React Markdown.

The selected-room and inline Console paths are separate projection calls even though they share the final renderer.

The browser proof must exercise all three paths.

An E2E fixture can use the real server and SQLite transcript path, following the direct durable-row seeding precedent in `e2e/ui/occurrence-navigation.spec.ts:185-264`.

The test should seed a text row whose exact stored payload is `{"report":"# Readable report"}` for a node whose fetched definition declares one string property named `report`.

The test should open the Console log view and assert that the inline execution history shows the rendered heading without the wrapper key or braces.

The test should open the same Console selected room and assert the same result.

The test should open `/legacy/workflows/runs/:runId`, open the same node room, and assert the same result.

The test should call the real node-message API and assert that `payload.text` is still the exact JSON string.

The test should include a malformed row and a multi-field row and assert that both remain exact fallback text.

If creating a dedicated workflow fixture is excessive, the test can intercept only the two definition responses while it keeps the run-detail and node-message APIs real.

The route-fulfilled visual-fixture precedent is documented at `e2e/ui/agent-tool-row-visual.spec.ts:13-24` and implemented at `e2e/ui/agent-tool-row-visual.spec.ts:180-204`.

The test must label an intercepted definition as a deterministic UI fixture and must not claim provider conformance.

## TDD matrix

### Shared projection tests to write first

Add the core red tests to `packages/web/src/lib/agent-history.test.ts` before production code.

One test must prove that JSON-looking natural-language text stays unchanged when `outputFormat` is absent.

One test must prove that an exact one-string schema and exact one-key object produce only the string value.

One test must prove that item ID, sequence, execution scope, and input rows stay unchanged after unwrapping.

One test must prove that a plain preamble stays unchanged when a later complete assistant message unwraps.

One test must prove that text assembled from deltas unwraps only after `projectTextTranscript()` produces the complete JSON string.

One table-driven test must keep the original text for malformed JSON, fenced JSON, prose plus JSON, arrays, primitives, null, a missing key, a non-string value, and an extra payload key.

One table-driven test must keep the original text for no `properties`, non-object `properties`, zero properties, multiple properties, and a single property whose type is not exactly `string`.

Keep `packages/web/src/lib/project-text-transcript.test.ts` unchanged and run it as a regression suite because stream assembly ownership does not change.

### Legacy component tests to write first

Add a test to `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx` that gives the selected node a one-string `output_format`, returns an exact raw JSON text row, and asserts that the room contains the field value without the serialized wrapper.

Add a fallback assertion in the same file for an absent or multi-field schema.

`packages/web/src/components/workflows/NodeTranscriptPane.test.tsx` should add a narrow prop-to-projection test only if the Legacy room test cannot isolate a missed forwarding edge.

The existing NodeTranscriptPane suite already owns transcript loading and scroll behavior, so it should not duplicate the full schema matrix.

### Console component tests to write first

Add a selected-room test to `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` with the same raw row and node schema.

Add an inline-history test to `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` that passes the output schema and asserts the same readable value.

Add a `ConsoleInspectPane` integration test to `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx` that proves the loaded definition reaches both the mounted selected room and `renderExecutionBody` inline history.

The `ConsoleInspectPane` test is important because a direct `ConsoleExecutionHistory` test cannot detect an omitted production prop.

No test change is required in `ConsoleAgentHistoryList` because its contract remains `AgentHistoryItem[]`.

### Browser tests to write first

Add the three-path structured-output test to `e2e/ui/workflow-run-hitl-room.spec.ts` or a new focused `e2e/ui/structured-output-transcript.spec.ts` if fixture setup would obscure the existing HITL contract.

Confirm that the E2E test fails because the UI shows the JSON wrapper before the projection code changes.

The final E2E assertions must prove readable Legacy output, readable Console selected-room output, readable Console inline output, exact durable API text, and lossless fallback.

### Verification commands after implementation

Run `bun test src/lib/agent-history.test.ts src/lib/project-text-transcript.test.ts` from `packages/web` first.

Run `NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx` from `packages/web` next.

Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` from `packages/web` next.

Run `bun --filter @archon/web type-check` from the repository root.

Run `bun run --cwd e2e typecheck` from the repository root.

Run the focused Playwright file with `bun run --cwd e2e playwright test -c playwright.config.ts ui/<file> --grep "structured output"` or use the equivalent local package command.

Run `bun run validate` before delivery because the shared projection is used by both web surfaces.

## Exact structured-output file inventory

### Production files that should change

- `packages/web/src/lib/agent-history.ts` should own the exact schema-gated display transform and its optional input.

- `packages/web/src/components/workflows/NodeTranscriptPane.tsx` should accept and forward the optional schema.

- `packages/web/src/components/workflows/LegacyNodeRoom.tsx` should pass `resolution.definitionNode?.output_format` for agent rooms.

- `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` should pass `resolution.definitionNode?.output_format` to the shared projection.

- `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx` should accept the optional schema and pass it to the shared projection.

- `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` should pass the matched schema to every inline execution history.

### Test files that should change

- `packages/web/src/lib/agent-history.test.ts` should own the complete deterministic rule matrix.

- `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx` should prove Legacy wiring.

- `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` should prove selected-room Console wiring.

- `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` should prove inline Console behavior.

- `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx` should prove definition ownership and prop forwarding.

- One focused Playwright file should prove the real browser paths and the unchanged API payload.

### Files that should not change for this repair

- `packages/web/src/lib/project-text-transcript.ts` should remain the stream-assembly owner.

- `packages/web/src/components/workflows/NodeRoom.tsx` should continue to render `AgentHistoryItem.text` as Markdown.

- `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` should continue to render the same item contract.

- `packages/providers/src/codex/provider.ts`, `packages/workflows/src/dag-executor.ts`, and server API files should retain the audit and execution contracts.

- `packages/web/src/lib/api.generated.d.ts` should not be edited because the required type already exists.

## Connected Legacy scroll defect

### Verified ownership

`packages/web/src/components/workflows/NodeTranscriptPane.tsx:433-466` makes `[data-testid="node-transcript-scroll"]` the actual transcript scroll owner with `min-h-0`, `flex-1`, and `overflow-y-auto`.

`packages/web/src/components/workflows/NodeRoom.tsx:218-237` gives the containing room region `min-h-0` and `overflow-hidden` when NodeTranscriptPane owns scrolling.

The flex minimum height is therefore not missing at the inner transcript owner or the room region.

`packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:485-525` wraps the room in a full-height, minimum-zero, overflow-hidden container.

`packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:535-579` owns the outer resizable split.

The left `legacy-run-view` panel has `flex min-h-0 flex-col` at `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:554-564`.

The right `legacy-run-room` panel has no class at `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:568-575`.

`packages/web/src/components/ui/resizable.tsx:32-34` forwards the panel props and supplies no default containment class.

The right panel therefore has a real flex and overflow containment gap, but supplied live browser evidence identifies a more direct cause of the extreme document height.

The live Legacy page measured `document.documentElement.scrollHeight` at approximately 18,000 pixels, and wheel input changed `window.scrollY` instead of staying in the transcript.

The far-down boxes were absolute `span.sr-only` status labels inside static tool-row `summary` elements.

`packages/web/src/components/workflows/NodeRoom.tsx:813-859` renders the Legacy tool-row summary without a positioned containing block and places the `sr-only` status span at line 825.

Tailwind's `sr-only` utility uses absolute positioning, so a static summary does not contain the label's absolute static-position geometry.

In a long transcript, those boxes occur at far-down row positions and contribute the observed document-height overflow.

Adding `relative` to the tool-row summary gives each hidden label a local containing block and keeps its absolute box inside the row.

The duplicated Console markup has the same static summary and hidden status span at `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:747-776`.

The Console tool summary should receive the same `relative` class even if its fixed Console shell has not exposed the same visible failure.

`packages/web/src/components/layout/Layout.tsx:6-10` uses a fixed viewport shell, but its `main` flex child has no explicit `min-h-0` and the global body CSS at `packages/web/src/index.css:146-151` has no overflow or overscroll rule.

No inspected Legacy room ancestor or transcript scroller declares `overscroll-behavior`.

The measured `window.scrollY` change proves that wheel input reaches the outer document after it leaves or exhausts the intended scroll owner.

The defect therefore has three connected gaps: the hidden status label lacks a local containing block, the right resizable panel lacks height and overflow containment, and the run shell has no scroll-chain guard.

### Recommended repair order

First, add `relative` to the Legacy and Console tool-row summaries that directly contain the absolute `sr-only` status spans.

Second, add `min-h-0` and `overflow-hidden` to the `#legacy-run-room` `PercentResizablePanel`, matching the explicit containment of its sibling and child.

Third, add `overscroll-behavior: contain` to the transcript scroll owner so wheel input at its top or bottom does not chain upward while the pointer remains over the transcript.

Fourth, verify the clarified case where the pointer is over a non-scrolling room area.

If that case still moves the document, contain overscroll at the fixed Legacy run shell or its `Layout.main` boundary and add `min-h-0` to `Layout.main`.

Do not add a wheel event handler because CSS owns this layout and scroll-chain invariant.

Do not apply `body { overflow: hidden }` without a route sweep because other Legacy pages can depend on document scrolling.

The panel fix is local and low risk, while a Layout or body rule has a site-wide blast radius.

The positioned-summary fix is the cause-aligned repair for the approximately 18,000-pixel document, while the panel and overscroll changes enforce the intended fixed-shell boundary.

### Scroll TDD and browser proof

Add a class-contract test to `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` that asserts `#legacy-run-room` has `min-h-0` and `overflow-hidden`.

Add a Legacy markup test to `packages/web/src/components/workflows/NodeRoom.test.tsx` that asserts every tool-row summary is `relative` and directly contains its `sr-only` status label.

Add the equivalent Console markup assertion to `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` because the duplicated summary has the same geometry risk.

Extend the existing NodeTranscriptPane structure assertion at `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx:1103-1131` if the scroller gains an overscroll utility.

Use a real browser test because happy-dom cannot prove flex geometry, wheel targeting, scroll chaining, or blank viewport space.

Extend `e2e/ui/workflow-run-hitl-room.spec.ts`, which already owns the long-history fixture at `e2e/ui/workflow-run-hitl-room.spec.ts:641-735`.

Open the Legacy long-history room at the split and narrow viewports.

Record the app header rectangle, room header rectangle, transcript `clientHeight`, transcript `scrollHeight`, document `clientHeight`, document `scrollHeight`, and document scroll position.

Record each tool-row summary rectangle and its direct `sr-only` label rectangle, and assert that every label box stays inside its owning summary after the repair.

Move the pointer over the transcript, wheel it to the bottom, and assert that only the transcript scroll position changes.

Wheel again at the boundary and assert that the app header and room header rectangles do not move and the document scroll position stays zero.

Move the pointer over the room header or adjacent non-scrolling room area, wheel again, and assert the same fixed-shell invariants.

Assert that `document.scrollingElement.scrollHeight` does not exceed its client height by more than one pixel and that no blank region becomes reachable below the transcript.

Repeat the final boundary assertions at `390x844` because the single-panel layout changes the panel sizing path.

### Scroll proof status and remaining point

The supplied live evidence proves the current document overflow, the escaped `window.scrollY`, and the far-down absolute hidden-label boxes.

The red browser test must preserve those measurements as regression assertions and must decide whether the positioned summary plus local panel and scroller containment is sufficient or whether `Layout.main` also needs the fixed-shell guard.

## Legacy run minimap removal

`packages/web/src/components/workflows/WorkflowExecution.tsx:945-959` mounts `WorkflowDagViewer` for the Legacy run graph.

`packages/web/src/components/workflows/WorkflowDagViewer.tsx:1-19` imports React Flow `MiniMap` and the `ExecutionNodeData` type used only by its color callback.

`packages/web/src/components/workflows/WorkflowDagViewer.tsx:28-34` defines constants used only for minimap colors.

`packages/web/src/components/workflows/WorkflowDagViewer.tsx:82-115` renders the Legacy run graph, including the minimap at lines 106-113.

The minimal removal deletes the `MiniMap` import, the `ExecutionNodeData` type import, the minimap color constants, and the `MiniMap` JSX.

The React Flow background and controls remain unchanged.

No other production file is required for the minimap removal.

The Console run graph is a separate SVG and HTML renderer documented at `packages/web/src/experiments/console/components/RunGraphPanel.tsx:1-4`.

`packages/web/src/experiments/console/components/RunGraphPanel.tsx:244-282` renders zoom-out, zoom-in, Fit, and the scrollable canvas, but it has no minimap.

The Console builder minimap at `packages/web/src/experiments/console/builder/components/BuilderCanvas.tsx:378` and the Legacy builder minimap at `packages/web/src/components/workflows/WorkflowCanvas.tsx:560` are authoring surfaces and are out of scope.

Add a red assertion to the existing real `WorkflowExecution` graph test in `packages/web/src/components/workflows/WorkflowExecution.test.tsx` that `.react-flow__minimap` is absent while `.react-flow__controls` remains present.

Add a browser assertion in the Legacy graph path that `.react-flow__minimap` has count zero if the plan needs explicit visual proof.

No Console minimap test or source change is required because the Console run view has no minimap implementation.

## Exact connected-scope file inventory

### Scroll production files

- `packages/web/src/components/workflows/NodeRoom.tsx` should position the Legacy tool-row summary so its direct absolute `sr-only` child stays local.

- `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` should apply the same containing-block fix to the duplicated Console summary.

- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` should contain the right resizable panel with `min-h-0` and `overflow-hidden`.

- `packages/web/src/components/workflows/NodeTranscriptPane.tsx` should own transcript-boundary overscroll containment if the red browser test confirms that utility is necessary.

- `packages/web/src/components/layout/Layout.tsx` is conditional and should change only if local fixes still let the pointer-outside case move the document.

### Scroll test files

- `packages/web/src/components/workflows/NodeRoom.test.tsx` should own the Legacy positioned-summary contract.

- `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` should own the equivalent Console contract.

- `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` should own the right-panel containment contract.

- `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx` should own the scroller class contract.

- `e2e/ui/workflow-run-hitl-room.spec.ts` should own document height, hidden-label geometry, wheel chaining, header position, and blank-region browser proof.

### Minimap production and test files

- `packages/web/src/components/workflows/WorkflowDagViewer.tsx` is the only production file that should change for the Legacy run minimap removal.

- `packages/web/src/components/workflows/WorkflowExecution.test.tsx` should prove that the Legacy run graph has controls but no minimap.

- A focused assertion in `e2e/ui/workflow-run-hitl-room.spec.ts` can provide browser proof without changing any Console graph file.

## Combined implementation sequence

Write and run the structured-output shared projection tests first.

Write and run the three production-wiring component tests next.

Write the three-path browser test and confirm the raw JSON failure.

Implement the exact shared projection rule and wire all three callers.

Write the Legacy scroll browser test and preserve the supplied approximately 18,000-pixel document height, far-down hidden-label rectangles, escaped `window.scrollY`, and panel metrics as the failing baseline.

Apply the local positioned-summary fix first, then add the right-panel and transcript overscroll boundaries required by the measured invariants.

Write the Legacy minimap absence assertion and confirm it fails before removal.

Remove only the Legacy run minimap code.

Run focused tests, both package type checks, the focused browser tests, and then the repository validation gate.

## Risks

The current definition can reinterpret historical rows because no immutable run-definition snapshot was found.

An overly permissive JSON rule can hide extra fields or reformat natural prose, so exact schema and payload matches are mandatory.

Applying the transform before text-stream projection can parse an incomplete delta or display duplicate fragments.

Updating only selected rooms leaves Console inline history inconsistent.

Using a top-level `find()` for Console inline rows breaks nested loop-group node IDs.

A global body overflow rule can regress pages outside the run inspector.

An overscroll utility on only the transcript cannot stop wheel input that begins outside the transcript area.

Removing every `MiniMap` search result would incorrectly change both workflow builders.

## Unresolved questions

The product owner must decide later whether multi-field structured outputs should get a dedicated readable object view with an explicit raw disclosure.

The current bug fix should not make that decision implicitly.

The red Legacy browser test must determine whether the positioned summaries plus local panel and scroller containment fully fix the pointer-outside case or whether the fixed Layout shell also needs `min-h-0` and an overscroll boundary.

No backend blocker or generated-type blocker exists for the recommended structured-output change.
