---
phase: 3
title: 'End-to-end and visual verification'
status: pending
priority: P1
dependencies: [2]
---

# Phase 03 — End-to-end and visual verification

## Objective

Update the existing HITL browser journeys to the final Raw contract and prove keyboard, accessibility-tree, contrast, responsive, and long-payload behavior on the real application surfaces.

## Update the affected journeys

Repository inspection found seven old Input/Output source assertion sites across these three specs, not a generic six-site migration. Update every occurrence located by:

```bash
rg -n "Input|Output|View full output" \
  e2e/ui/workflow-run-hitl.spec.ts \
  e2e/ui/workflow-run-hitl-room.spec.ts \
  e2e/ui/agent-tool-row-visual.spec.ts
```

### `workflow-run-hitl.spec.ts`

Update both current tool-row tests to assert the final collapsed/default contract: the outer row remains collapsed, the hidden Raw control is closed, and no nested Input/Output disclosures or serialized payload are mounted.

### `workflow-run-hitl-room.spec.ts`

- Legacy expansion: open the tool row, confirm Raw is closed and payload absent, open Raw, and assert the canonical `{ name, input, output }` JSON.
- Console/default history: replace old hidden Input/Output assertions with the closed Raw contract.
- Long-history/full-output journey: keep the established Console integration path and its existing synthetic 20,000-character output. Verify the full-output action is available before Raw opens; after loading, the truncated tail is still absent from the DOM while Raw is closed, then appears after opening Raw. Assert the open Raw panel and page have no horizontal overflow and attach the long-payload evidence. Component coverage from Phase 02 proves the equivalent Legacy render classes and behavior.
- Do not invent a new expensive E2E failure fixture: rejected and malformed detail responses are already required in both component suites. Keep this browser journey focused on the real successful detail endpoint.

Use row-scoped locators because a room can contain multiple tool calls.

### `agent-tool-row-visual.spec.ts`

Extend the existing surface loop so the same assertions run for Legacy and Console:

- facts left / Raw right in the expanded body bar;
- closed, hover/focus, and open Raw control appearance;
- Raw `<pre>` uses primary text on inset surface and has no horizontal overflow;
- one click swaps the Raw panel in and a second click removes it;
- keyboard Tab order reaches Raw after the summary/body entry point, Enter/Space toggles it, and focus remains visible;
- accessibility-tree role/name/expanded/control relationship is correct. There is no axe harness in this repository, so do not claim one or add a dependency for this story.

Extend the viewport loop to `1440`, `1024`, `768`, the UX-canonical `460`, and `390px`, plus the existing `200%` zoom check. Open the outer row and Raw before measuring and assert no page-level horizontal scroll. The real long unbroken-value proof stays in the established long-history journey above so this loop does not start another expensive long-history run per surface.

Extend the existing contrast helper checks for:

- closed Raw label against the body-bar surface;
- hover/focus/open label against that surface;
- Raw JSON primary text against the inset surface.

Capture screenshots/evidence for both surfaces at desktop and `460px`, including closed and open Raw; add the Console long-history capture from the existing long-output journey. Update the spec's header comment so evidence points to this Story 1.2 supplement as well as the Story 1.1 report. Write measured states, keyboard/AX evidence, contrast ratios, overflow results, and source-artifact comparison to `plans/260918-1038-issue-175-raw-payload-toggle/reports/visual-acceptance.md`, with synthetic captures under its `reports/evidence/` directory. Full-output loading/error appearance has no additional design treatment in the source artifacts and is proven in component tests. Never use a real run containing credentials or customer payloads.

## Accessibility interpretation

The required release proof is keyboard behavior plus targeted Chromium accessibility-tree assertions on both surfaces. If a native VoiceOver or NVDA environment is available, perform and record a short spot-check; lack of two separate desktop assistive-technology environments is not a new blocker imposed by Story 1.2.

## Validation

Run the targeted HITL suite, then the full repository gate:

```bash
bun run --cwd e2e typecheck
bun run --cwd e2e test:ui:hitl
bun run validate
```

Before opening the PR, also confirm:

```bash
rg -n "formatToolIo|getByText\\('(Input|Output)'|>Input<|>Output<" packages/web/src e2e/ui
```

Any remaining match must be explained as unrelated copy or removed. Review screenshots at actual size rather than accepting snapshots mechanically.

## Delivery and rollback

- Target the active `develop` branch and include `Closes #175` in the repository PR template.
- PR E2E Verify should select the mapped Legacy tool-output, Console tool-output, and history-complete HITL scenarios; inspect its feature selection instead of assuming local-only coverage.
- No migration or coordinated rollout is required. A normal revert restores the prior renderer and shared presentation shape.
- After implementation and every required gate pass, use the issue-mandated `ak-feature` workflow to move sprint key `1-2-inspect-the-raw-payload-of-a-tool-call` to `done` before #175 closes.

## Exit criteria

- All seven old E2E assertion sites express the new contract and no stale bridge assertion remains.
- Both surfaces pass keyboard, accessibility-tree, contrast, viewport, zoom, overflow, long-payload, and visual review.
- The full validation gate and selected PR HITL scenarios pass.
- Evidence uses synthetic data and the PR is reviewable as a focused web-presentation change.
