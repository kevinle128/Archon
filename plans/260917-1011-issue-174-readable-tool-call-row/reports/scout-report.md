# Scout report

## Shared seam

`packages/web/src/lib/agent-history.ts` is the correct integration owner. It consumes paired transcript cards and workflow events, then feeds all three mounted transcript paths. The required shared changes are exit-code propagation, one presentation value per tool item, exact adjacent-interruption look-ahead, and deterministic running elapsed time from the existing `tool_called` event plus caller clock. `pair-tool-transcript.ts` already preserves the necessary data and is not a planned edit.

The pure presenter belongs in `packages/web/src/lib/tool-presentation.ts`, as specified by the canonical contract. Main correctness risks are alias substring collisions, Codex's command-as-name shape, Claude/OMP glob inversion, wide/deep JSON, unsupported count output, and allowing status/badge decisions to drift into renderers.

## Renderer seams

Legacy owns tool markup in `NodeRoom.tsx`. Console owns it in `ConsoleAgentHistoryList.tsx`, which is reused by both `ConsoleNodeRoom.tsx` and `ConsoleExecutionHistory.tsx`. The inline history test is therefore an indirect regression gate even though no caller source change is expected.

Both current shells render an inset card and open diagnostic disclosures. Native `<details>` remains the right primitive, but controlled untouched/touched state is needed because `defaultOpen` alone cannot open a stable running row when polling changes it to failed.

The Console boundary allows shared library data but no Legacy component import. Two markup shells remain the simplest compliant design.

## E2E and visual seams

The existing HITL fixture navigates both target surfaces against one stored successful call. Three cases—not two—assert obsolete visible output. The old visual readiness locator can match hidden descendant output and needs a direct-summary locator.

The required responsive width is the measured node room at 460 px, not merely a viewport or splitter ratio. Geometry/computed styles are deterministic gates; screenshots are human evidence. Other status states stay in component tests because the real fixture does not emit them.

## Dependency conclusion

No backend, provider, workflow, API, generated type, schema, migration, dependency, or theme-token work is needed. No active alternate plan or open implementation PR was found; PR #194 is closed/unmerged and the issue-comment run is completed. Recheck mutable ownership state before implementation.
