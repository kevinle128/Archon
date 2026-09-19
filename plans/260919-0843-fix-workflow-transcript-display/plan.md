---
title: 'Fix workflow transcript display and Legacy run viewport'
description: 'Repair structured transcript presentation, ACP chunk grouping, Legacy room scroll containment, and the Legacy runtime graph minimap.'
status: pending
priority: P1
issue: 'https://github.com/kevinle128/Archon/issues/208'
effort: '3 phases'
branch: develop
tags: [bugfix, frontend, providers, e2e, tdd]
blockedBy: []
blocks: []
created: 2026-09-19
revised: 2026-09-19
---

# Fix workflow transcript display and Legacy run viewport

## Goal and user outcome

Issue 208 describes four connected defects in workflow run rooms:

1. Devin and DeepSeek ACP text notifications are persisted as complete messages, so one streamed answer renders as many assistant rows.
2. A node whose `output_format` is one top-level string renders the serialized JSON envelope instead of the string's Markdown content.
3. A long Legacy transcript can enlarge and scroll the document, exposing a blank region outside the fixed run shell.
4. The Legacy runtime graph shows a minimap that the run-room design does not require.

The repaired experience groups new ACP fragments into one answer per execution attempt, presents the narrow one-string structured result readably in every Web transcript mount, keeps the Legacy run shell fixed to the viewport, and removes only its runtime minimap. Audit rows, API text, structured node output, downstream references, builders, and unrelated providers remain unchanged.

## Verified scope and non-goals

- Apply the presentation rule to all three callers of `buildAgentHistory()`: Legacy room, Console selected room, and Console inline execution history.
- Mark only Devin and DeepSeek ACP `agent_message_chunk` text as `textMode: 'delta'`; do not infer or rewrite historical rows without `text_mode`.
- Rotate the loop attempt identifier before the existing missing-structured-output re-ask. Direct re-asks and loop invalid-output re-asks already rotate correctly.
- Fix the duplicated hidden-label geometry in both Legacy and Console renderers, but limit panel containment and minimap removal to the Legacy runtime view.
- Keep workflow-builder minimaps, multi-field structured rendering, non-Web batch formatting, database migrations, API transforms, generated types, provider buffering, fabricated stream IDs, JavaScript wheel handlers, and new dependencies out of scope.

## Evidence inspected

- Issue 208 and the plan's co-located research and reports.
- Provider contracts, Devin and DeepSeek event bridges and ACP client tests, executor persistence/re-ask paths, and text projection tests.
- Every `buildAgentHistory()` production caller, both Markdown renderers, definition-node lookup, generated DAG types, and the Legacy layout/DAG components.
- Browser fixtures, isolated runtime helpers, fake-provider capabilities, verification-skill catalog/configuration, and current visual capture tests.
- Canonical node-room specification, its adopted final `DESIGN.md` and `EXPERIENCE.md` companions under `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/`, its absorbed source specs, and the HITL mockup under `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/`.
- Existing focused tests: provider bridge tests and projector/history tests pass on the baseline. Two DOM suites could not start in this checkout because the declared `happy-dom` development dependency is not installed; this is an environment prerequisite, not evidence that the product behavior passes or fails.

## Design authority and resolved conflict

The final node-room specification and its adopted companions are the authority for transcript presentation and accessibility; the HITL mockup supplies the runtime graph/layout reference where they are silent. The specification currently says raw serialized JSON is never a default transcript presentation, while issue 208's accepted lossless requirement says malformed, complex, or noncanonical assistant text remains byte-for-byte visible. The issue is narrower and concerns assistant prose rather than tool payload rendering, but the words still conflict. Phase 2 must update the owning specification before the code change to state the resolved rule: tool payloads keep their explicit Raw affordance, exact one-string envelopes show their string value, and assistant text that cannot be losslessly classified fails closed to its original text. If maintainers do not accept that specification change, Phase 2 is blocked and must not invent a different fallback.

The historical issue-83 delivery plan says to retain the Legacy runtime minimap, while the current issue and final HITL mockup omit it. Repository rules classify completed plans as stateful records rather than evergreen product authority, so this plan intentionally changes only the runtime viewer and preserves both builder minimaps. Do not edit historical plan records to make them appear current.

## Delivery phases

| #   | Phase                                                                                                | Depends on |
| --- | ---------------------------------------------------------------------------------------------------- | ---------- |
| 1   | [Provider delta boundaries](./phase-01-start.md)                                                     | —          |
| 2   | [Structured transcript presentation](./phase-02-structured-transcript-presentation.md)               | Phase 1    |
| 3   | [Legacy run viewport and regression coverage](./phase-03-legacy-run-viewport-regression-coverage.md) | Phases 1–2 |

## Selected design

1. Add `textMode: 'delta'` at each ACP event bridge. Existing executor metadata and `projectTextTranscript()` then carry and group the provider-known semantics without new state.
2. Fix the one proven missing attempt boundary in the loop missing-output branch so separate model responses cannot merge.
3. Add optional `outputFormat` presentation context to `buildAgentHistory()`. After text projection, unwrap a block only when:
   - the schema is a non-array record with `type === 'object'` and exactly one own property declaration;
   - that property's schema is an object with `type === 'string'` (annotations and constraints may coexist);
   - the entire assistant block parses to a non-array object with exactly the same own key and a string value; and
   - the original bytes equal `JSON.stringify(parsed)`.
4. Return the original string for every failed guard. Preserve item identity, sequence, execution metadata, input objects, stored rows, server output, and engine output.
5. Use a deterministic workflow definition and isolated SQLite row seeding for browser presentation/layout proof. Unit and executor tests prove provider/executor semantics; the browser test proves the real server/API/definition/Web boundary without changing the fake provider's global capability contract.
6. Repair the measured Legacy overflow locally: position each direct hidden label relative to its summary, contain the right run panel, and contain transcript overscroll. Escalate to the shared layout only if post-fix browser metrics still prove an ancestor defect.
7. Remove `MiniMap` only from `WorkflowDagViewer`, retaining React Flow controls, zoom, pan, fit, layout, focus, and selection.

## End-to-end proof plan

| Behavior                     | Boundary under test                                                                                         | Proof                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New ACP chunk grouping       | Real ACP SDK/child-process notification → bridge → executor metadata → projector                            | Provider bridge/client tests plus direct/loop executor and projector tests; tool, occurrence, and attempt boundaries stay separate.                                                                  |
| One-string display           | Real workflow definition/API rows → definition lookup → `buildAgentHistory()` → existing Markdown renderers | Unit decision matrix, three caller component tests, and isolated real-server browser assertions. API rows remain the exact seeded fragments and metadata; only the projected Web block is unwrapped. |
| Engine structured contract   | Provider chunks → executor structured result → downstream `$producer.output.report`                         | Executor test proves the durable output and downstream reference independently of browser row seeding.                                                                                               |
| Legacy fixed viewport        | Long real-server history → Legacy run shell and room                                                        | Browser geometry and wheel assertions at `1440x1000` and `390x844`; inner tail remains reachable while root height/scroll remain fixed.                                                              |
| Runtime graph simplification | Definition DAG → `WorkflowDagViewer`                                                                        | Component/browser checks prove no runtime minimap and retained controls, transform changes, fit, focus, and node selection; builder canvases remain unchanged.                                       |

All proof above is planned, not yet executed against an implementation.

## Visual acceptance criteria

At both `1440x1000` and `390x844`:

- A matching report block shows only the string value, using the existing assistant role label, typography, Markdown, link handling, wrapping, spacing, and focus behavior; the JSON key, braces, quotes, and escapes are absent.
- Malformed or ineligible assistant blocks remain fully visible without clipping or invented formatting; no page-level horizontal overflow is introduced.
- Legacy and both Console mounts agree on content. Inline Console history is checked before selecting a room because selection intentionally replaces that surface.
- The Legacy app header, run header, tabs, room header, graph, resize boundary, and transcript remain within the viewport. The root scroll height is at most two pixels over its client height and root scroll position stays zero after transcript-boundary and pointer-exit wheel input.
- The transcript itself reaches its final row with pointer and keyboard scrolling. Ask controls or the composer, occurrence controls, jump control, todo strip, resize handle, visible focus, and focus restoration remain usable where present.
- Direct hidden status labels have bounding boxes within their tool summaries and remain available to assistive technology.
- The Legacy runtime graph has no minimap. Controls remain visible; pan, zoom, fit, focus, layout, and node selection still work. Workflow builders are visually and functionally unchanged.

## Compatibility, rollout, and rollback

- No schema or stored-data migration is needed. Historical untagged ACP rows remain as recorded.
- A current workflow definition can reinterpret an old exact-matching assistant row because definitions are not snapshotted. Exact canonical guards and fail-closed definition loading bound this known residual risk.
- Definition lookup may initially be unavailable while a Console view loads; render original text, then rerender when the definition arrives rather than hiding history.
- The canonical node-room specification is the smallest owning documentation surface. No CLI, configuration, API, setup, or docs-site contract changes, so no public documentation update is required.
- Each phase is independently reversible. Revert provider labels/attempt rotation, Web presentation plumbing, or Legacy CSS/minimap code with its tests. Seeded E2E data and verification metadata have no runtime rollout effect.

## Acceptance criteria

- [ ] New Devin and DeepSeek ACP text chunks persist with `text_mode: 'delta'` and render as one assistant block within one occurrence and attempt.
- [ ] Direct, loop-invalid, and loop-missing structured-output re-asks keep each response in a distinct transcript attempt.
- [ ] An exact one-string envelope renders as its string value in Legacy, Console selected room, and Console inline history.
- [ ] Absent/ineligible schemas and malformed, duplicate-key, noncanonical, extra-key, or non-string payloads remain byte-for-byte unchanged.
- [ ] Stored/API assistant text, item metadata, structured node output, and a downstream `$producer.output.report` consumer remain unchanged.
- [ ] Legacy root height stays within two pixels of the viewport and root scroll position stays zero through inner-boundary and pointer-exit wheel cases at both required viewports.
- [ ] Transcript tail, applicable controls, keyboard traversal, visible focus, keyboard scrolling, and focus restoration remain reachable and usable.
- [ ] The Legacy runtime graph has no minimap while controls, pan, zoom, fit, layout, focus, and node selection pass; builder minimaps remain.
- [ ] The canonical node-room specification and governed functional/visual verification contracts describe and prove the delivered states.
- [ ] Focused suites, package-isolated tests, build/type/lint/format checks, browser proofs, and `bun run validate` pass without weakened assertions.

## Implementation readiness review

- **Product:** the four changes map directly to the reported user-visible failures; unrelated transcript redesign is excluded.
- **Architecture/contracts:** provider-known semantics enter at provider boundaries; shared presentation stays in the render-neutral history projector; durable/API/engine contracts do not change.
- **Security/data integrity:** exact parsing is fail-closed, does not evaluate input or enable raw HTML, and never rewrites stored audit data.
- **Performance/scalability:** projection performs one bounded schema inspection and JSON parse per assistant block; no buffer or additional request is introduced.
- **Completeness/testing:** direct, loop, all three Web mounts, long-history geometry, keyboard access, graph interactions, and verification governance have named proof.
- **Operations/compatibility:** no migration, feature flag, dependency, or coordinated rollout is required; rollback is phase-local.
- **Maintainability:** existing owners and helpers are reused; no generic renderer, shared ACP abstraction, or speculative stream identity is added.

## Remaining assumptions and risks

- The plan treats issue 208's accepted lossless fallback as authority for a narrow canonical-spec clarification. If maintainers reject that documentation change, Phase 2 is blocked pending a product/design decision.
- The saved live-reproduction measurements are prior evidence; implementation must recapture the RED browser metrics before changing CSS.
- Component tests that use the DOM require dependencies installed from the lockfile, including `happy-dom`.
- The canonical serialization guard intentionally rejects semantically equivalent but differently formatted JSON. This favors lossless audit presentation over aggressive cleanup.
- The current-definition/historical-row mismatch cannot be eliminated without definition snapshots, which is outside this bug's proportional scope.

<!-- slug: fix-workflow-transcript-display -->
