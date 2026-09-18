---
title: 'Phase 2: Legacy and Console renderers'
status: todo
depends_on: [phase-01]
---

# Phase 2: Legacy and Console renderers

## Objective

Replace the old filled JSON cards with equivalent native disclosure rows in both target shells. Both shells consume the shared row model; neither reclassifies names, constructs headlines, maps outcomes, orders badges, or imports the other surface.

## Files

| Path                                                                                       | Action                 | Purpose                                                                                 |
| ------------------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------- |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                                  | Modify first           | Legacy static DOM/anatomy and diagnostic structure                                      |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                            | Modify first           | Legacy interactive rerender, pointer, keyboard, focus, and loading behavior             |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                       | Modify after red tests | Legacy row shell                                                                        |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Modify first           | Console selected-room anatomy and interactions                                          |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Modify first           | Inline-history reuse and regression coverage                                            |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`      | Modify after red tests | Console row shell used by both mounts                                                   |
| `packages/web/src/experiments/console/console-isolation.test.ts`                           | Verify/conditional     | Preserve Console boundary; edit only for an actually required shared-lib allowlist path |
| `packages/web/src/lib/agent-history.ts`                                                    | Modify last            | Remove superseded `context` only after all consumers move                               |
| `packages/web/src/lib/agent-history.test.ts`                                               | Modify last            | Remove only superseded context expectations                                             |

Phase 1 makes only the caller change required by running elapsed time: each of the three existing projection callers passes its already-computed render clock. This phase does not otherwise change caller or list APIs because `buildAgentHistory()` remains an array and `ConsoleAgentHistoryList` keeps its current item contract.

## Required DOM and interaction contract

For each item, render one `<details data-tool-id={item.toolUseId}>` keyed by the existing stable item ID. Its direct `<summary>` is the complete row toggle and contains, in accessible-name order:

1. Decorative chevron (`aria-hidden`).
2. Visually hidden status word, followed by visible glyph (`aria-hidden`).
3. Family chip whose visible text is the presenter label and whose label/title is `family · displayed-label` (or just family when identical). Do not put an overlong/multiline rejected sent name into the accessibility tree or tooltip.
4. Headline.
5. Ordered badge group; separators are decorative.

Visible `running`/`interrupted` state badges duplicate the visually hidden status word, so mark those badge texts `aria-hidden`; the status word remains the single accessible state. The no-fact `—` placeholder is also decorative. Other badge facts stay in the accessible name.

The opened area begins with a minimal body bar whose first word is the family followed by every summary fact, including duration even when responsive styling hides it above. Below it, retain Input and Output as nested closed `<details>` disclosures. Opening the outer failed row must reveal neither JSON nor the payload values until the user separately opens a diagnostic disclosure. Preserve the current full-output control, loading, error, and retry semantics below the diagnostics; do not move them into the summary.

Because the temporary diagnostic summaries remain interactive, style them as real controls rather than preserving the current dim labels: text-secondary, at least 24 px high, visible accent focus, and native Enter/Space behavior. Their DOM/Tab order follows the outer summary and visual body order; the body bar itself is not focusable. Story 1.2 removes this bridge in favor of Raw.

Normally render `item.presentation`. After a local full-output fetch succeeds, call the same pure presenter with the unchanged item facts plus the loaded output and `outputState: 'full'`; do not filter/rebuild badges in JSX. The refreshed presentation must remove the stale truncation marker without changing the stable item key or touched disclosure state.

This temporary body is intentionally narrower than the final Story 1.2/1.3 mockup: there is no Raw button or family body yet.

## Disclosure state algorithm

Each shell needs local state per stable tool item:

- Initialize `open` from `presentation.initialOpen` only on mount/item identity change.
- Track whether a user has changed the native disclosure. Pointer and Enter/Space toggles must both mark it touched.
- On a later outcome becoming failed, set `open = true` only when untouched and currently closed.
- Never automatically close a row on any later outcome. A manual open or close always wins after it occurs.
- When using a controlled `open` prop, distinguish a native user toggle from the toggle event produced by applying the controlled value (compare DOM state with the rendered state or suppress the known programmatic event). Do not mark an automatic failure-open as a user action accidentally.
- Ignore nested diagnostic toggle events (`event.target !== event.currentTarget`) so opening Input or Output cannot mark or change the outer tool-row disclosure.
- A newly selected node/new item identity starts from its own initial policy; state must not leak across IDs.

Use the same transition matrix in Legacy and Console tests rather than relying on `defaultOpen`, which cannot respond to polling.

## Visual implementation contract

- Row rest state: transparent on the room `surface`, no old `surface-inset` card fill, border, or shadow. Hover: `surface-hover`. Focus: no hover fill, 2 px `--accent-bright` outline, offset −2 px Legacy / +2 px Console.
- Transcript list: 10 px vertical/12 px horizontal padding. Remove the current unconditional `gap-3` between adjacent tool wrappers so collapsed rows form the compact scan list in both final mockups; preserve assistant, lifecycle, extension-slot, and notice separation with explicit per-item margins instead of a global card gap.
- Summary: mono 12 px at weight 400, 4 px/6 px padding, 8 px gap, 6 px radius, minimum height 24 px, baseline alignment, single line, `min-width: 0` where required. Only the status glyph is bold inside the row; chip, headline, and badges remain weight 400.
- Chevron: 10 px text in a fixed 9 px column, text-tertiary, 90° open rotation over 120 ms; `motion-reduce` removes transition. Glyph: 12 px bold text in a fixed centered 12 px column.
- Chip: mono 11 px, 1 px/7 px padding, 4 px radius, maximum 24ch, `surface-elevated`, and the contract family border/text tone. Search/glob text uses `color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))`; their border uses the documented 45% mix. Use the existing family tokens for all other families.
- Headline: primary text except the documented folded todo-call headline, which is secondary. For `path`, split into a secondary shrinkable non-growing head and primary fixed final nonempty segment; recognize `/` and `\`, preserve trailing separators with the tail, and use the same anatomy for URLs. If there is no usable separator/segment, render one tail. Keep the full accepted string across the spans. Cap the fixed tail at 100% of the flexible headline wrapper with overflow ellipsis so an adversarial filename cannot push out glyphs/badges. For `text`, use one shrinkable end-ellipsis span.
- Badges: mono 11 px, secondary text by default, right aligned, no wrap. Visible `running` and `interrupted` state badges use their running/warning tokens. The group may shrink; critical spans are `flex: none`, while duration is `flex: 0 1 auto` with `min-width: 0`, hidden overflow, and no wrapping so it collapses first without a transcript-specific breakpoint. Nonzero exit digits use a token-derived error/primary mix proven above 4.5:1; keep `exit` secondary.
- Body: margin 2 px 0 8 px 29 px, 2 px token border rail, and 10 px left padding. The family/body facts use 10.5 px mono text-secondary.

Use existing token-backed utilities plus small fully typed local class/style maps; express exact `color-mix` values as readable local CSS style values where an arbitrary utility would be opaque. Do not add tokens, a stylesheet, or a global styling abstraction.

## Tests before implementation

Run the same behavior matrix against both shells:

| Case                       | Required assertion                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Five initial outcomes      | succeeded/failed/running/interrupted/unknown map to closed/open/closed/closed/closed and the exact glyph/hidden status word                                                        |
| Pointer toggle + rerender  | User choice remains after unchanged and changed props                                                                                                                              |
| Keyboard toggle + rerender | Enter and Space use native behavior, mark touched, retain focus, and survive polling                                                                                               |
| Untouched transition       | Any untouched nonfailed row becoming failed opens once; later nonfailed updates do not auto-close                                                                                  |
| Touched transition         | Manually closed/open row remains so when it becomes failed                                                                                                                         |
| New identity               | State resets to the new item's table policy                                                                                                                                        |
| Accessible name            | Computed/queryable order is status, family/tool, target, facts; glyph/chevron do not add noise                                                                                     |
| Path and URL               | POSIX, Windows, URL, trailing-separator, no-separator, and long-tail cases keep full DOM text, retain the final segment, and never overflow; text uses end-elision anatomy         |
| Width priority             | Duration has the hide-first class/attribute; critical exit/count/output-state facts remain                                                                                         |
| Expanded body bar          | Starts with family and repeats all facts, including duration                                                                                                                       |
| Default diagnostics        | Nested Input/Output disclosures are closed; failed auto-open still exposes no serialized payload                                                                                   |
| Diagnostics                | Opening nested disclosures renders existing formatted data; full-output load, error, and retry still work; success refreshes the shared presentation and removes stale `truncated` |
| Nested toggle isolation    | Toggling Input/Output does not alter or mark the outer row; a later untouched failure transition still follows the outer policy                                                    |
| Diagnostic accessibility   | Input/Output summaries meet contrast, 24 px target, focus, Tab order, and native keyboard requirements                                                                             |
| Extension/identity         | `data-tool-id`, message identity, and after-item extension anchoring remain stable                                                                                                 |
| Indirect Console mount     | `ConsoleExecutionHistory` renders the same row contract without a second implementation                                                                                            |
| Focus/append               | Updating/appending items does not move focus; existing scroll behavior is not regressed                                                                                            |
| Adjacent-row rhythm        | Two collapsed tools have no 12 px inherited gap; mixed assistant/lifecycle/extension content keeps readable separation                                                             |

Scope queries to the direct summary for collapsed-row text. Do not use broad host `textContent` or a helper that treats hidden descendant payload text as visible.

## Implementation order

1. Convert Legacy and Console component expectations to the row contract and confirm equivalent red failures.
2. Implement the Legacy native disclosure, controlled state rules, minimal body bar, and closed diagnostics.
3. Preserve Legacy full-output loading/retry and extension-slot placement; refresh through the shared presenter after a successful load.
4. Implement the same semantic anatomy/state rules in `ConsoleAgentHistoryList.tsx`; do not import Legacy components.
5. Verify both Console selected-room and inline-history mounts.
6. Add exact token geometry, family/status tones, path/text elision, duration priority, focus offsets, and reduced-motion behavior.
7. Remove obsolete context rendering, then remove `AgentHistoryItem.context`, `TOOL_CONTEXT_KEYS`, `toolContext()`, and only their tests.
8. Turn all three Phase 1 HITL behavior cases green.

Small JSX duplication between shells is intentional. If disclosure-state logic proves too complex to keep identical, pause and revise the plan before introducing a shared React hook; do not create a shared component through the back door.

## Verification

From `packages/web`:

```bash
NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx
NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx
bun test src/experiments/console/console-isolation.test.ts
bun test src/lib/agent-history.test.ts
bun run type-check
```

From `e2e`:

```bash
npx playwright test -c playwright.config.ts ui/workflow-run-hitl.spec.ts ui/workflow-run-hitl-room.spec.ts --grep "HITL.*readable tool row"
```

## Exit criteria

- [ ] Both surfaces and both Console mounts render the same semantic row and transition matrix.
- [ ] All five states have the correct glyph, word, and initial state.
- [ ] Manual pointer/keyboard choices survive polling; untouched failure opens; no automatic path closes a row.
- [ ] Default success and failure states expose no serialized payload.
- [ ] Every hidden summary fact is present in the opened body bar.
- [ ] Full-output loading/retry, stable IDs, paging, ordering, empty/error states, extension slots, scroll, and focus behavior remain intact.
- [ ] Console isolation passes and no renderer contains resolver, headline, outcome, or badge policy.
- [ ] All three HITL behavior cases pass.

## Rollback

The safe unit is both renderer shells, shared-history context cleanup, component tests, and the three E2E cases. A rollback must restore the old code and matching tests together; it does not touch persisted data.
