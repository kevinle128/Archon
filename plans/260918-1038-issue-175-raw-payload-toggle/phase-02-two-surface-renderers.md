---
phase: 2
title: 'Legacy and Console renderers'
status: pending
priority: P1
dependencies: [1]
---

# Phase 02 — Legacy and Console renderers

## Objective

Replace the temporary nested Input/Output disclosures with the same closed-by-default Raw interaction on both node-room surfaces while preserving the existing full-output workflow.

## Test first

Add or update focused tests before changing markup.

### Shared/default server-render coverage

In `packages/web/src/components/workflows/NodeRoom.test.tsx`, assert only states that server rendering can prove:

- each expanded-body tool row contains one Raw button with `aria-expanded="false"`;
- no Raw `<pre>` or serialized payload text is present by default;
- no nested Input/Output `<details>` remains;
- facts and full-output affordance remain.

Do **not** attempt to prove the open state with the static server renderer.

### Legacy interaction coverage

In the existing happy-dom suite `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`, cover:

- opening the outer row and then Raw; correct accessible name, `aria-expanded`, conditional `aria-controls`, unique matching panel id, explicit open classes, and exact JSON shape;
- closing Raw removes the panel and payload text without closing the outer row;
- a pending card updated with its paired result keeps Raw open and updates the payload; a newly keyed history item begins closed;
- a long unbroken synthetic value renders with the contractual wrapping classes on the Raw `<pre>`;
- truncated full output remains loadable while Raw is closed and open;
- success replaces the presentation/Raw output with complete data;
- fetch rejection, non-OK response, wrong message kind, and missing output preserve the old content, show an error, and permit retry.

### Console interaction and reuse coverage

In the existing happy-dom suite `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`, mirror the behavior that can diverge in the Console implementation: toggle semantics, conditional payload, long-value wrapping classes, pairing update, full-output success, malformed detail response, error, and retry. Add a direct two-sibling `ConsoleAgentHistoryList` mount here; open both Raw panels and assert different `aria-controls` values that each resolve with `document.getElementById` to the correct panel (React `useId()` output is not assumed to be selector-safe).

In `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx`:

- replace the shared collapsed-row expectations with the default Raw anatomy and prove reuse through the execution-history caller.

Closed buttons legitimately omit `aria-controls`, so id uniqueness is tested only after opening.

Prefer role/name/state queries and row scoping over class-only assertions. Keep a small number of exact class assertions for the design tokens that are contractual.

## Implement both surfaces

Edit `packages/web/src/components/workflows/NodeRoom.tsx` and `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` in the same phase.

For each local tool-history component:

1. Add `rawOpen` state and a `useId()`-derived Raw panel id.
2. Remove the nested Input and Output `<details>` nodes.
3. Keep the facts flex group on the left and place the Raw button last on the right of the body bar. Allow facts to wrap without pushing the control off-screen.
4. Use a native `button` with visible `Raw` text; append an `aria-hidden` ` ▾` suffix only while open, matching the design and mockup. Add `aria-expanded`; include `aria-controls` only when open.
5. Apply the documented `24px` minimum height and padding, then verify the rendered target is at least `24px` in both dimensions. Use secondary closed text and bright-border/primary-text hover, focus-visible, and open states. Use explicit conditional classes; retain necessary Console `!` overrides.
6. Conditionally render the `<pre>` after the body bar from `toolRawPayloadJson(presentation.rawPayload)`. Use `text-text-primary` because the authoritative design-system structured binding specifies primary JSON text. Apply inset surface/border/radius, `px-2.5 py-2`, monospace `~11.5px/1.5`, and long-token wrapping.
7. Leave `View full output`, loading state, and inline error after the Raw slot so they are independent of Raw visibility.
8. On detail success, require a tool message with defined `output`, then run the existing `toolRowPresentation` path so facts and `rawPayload` both update. On invalid detail data, show `Full output is not available for this call` and keep the previous presentation.
9. Preserve the nested-interaction propagation guard and clarify its invariant in the comment.

Once both surfaces compile and tests pass, remove `formatToolIo` from `packages/web/src/lib/pair-tool-transcript.ts` and its focused tests/imports in `pair-tool-transcript.test.ts` after confirming no caller remains. Confirm with `rg "formatToolIo|>Input<|>Output<" packages/web/src` rather than assuming the cleanup is complete.

## Validation

```bash
NODE_ENV=development bun test packages/web/src/components/workflows/NodeRoom.test.tsx
NODE_ENV=development bun test packages/web/src/components/workflows/LegacyNodeRoom.test.tsx
NODE_ENV=development bun test packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx
NODE_ENV=development bun test packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx
bun --filter @archon/web test
bun run type-check
bun run lint
```

## Exit criteria

- Both implementations satisfy the same contract and consume the shared opaque payload.
- No Raw JSON is formatted or mounted while closed.
- Full-output success, invalid responses, failures, and retry are covered on both implementations.
- Multiple Console lists cannot collide on Raw panel ids.
- Temporary nested disclosures and the obsolete formatter are absent.
