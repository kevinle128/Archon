# Scout synthesis

## User-visible failures

1. A structured report appears as a serialized JSON object in the assistant transcript.
2. Devin ACP text fragments appear as separate `ASSISTANT` rows.
3. The Legacy run document scrolls after the pointer leaves the transcript region and exposes a large blank area.
4. The Legacy runtime graph shows an unwanted minimap.

## Root owners

- `packages/providers/src/community/devin/event-bridge.ts` and `packages/providers/src/community/deepseek/event-bridge.ts` omit the existing delta boundary.
- `packages/web/src/lib/agent-history.ts` copies projected assistant text without the selected node schema.
- Three production `buildAgentHistory()` callers require schema wiring.
- Static tool summaries let absolute `sr-only` labels create far-down root geometry.
- `legacy-run-room` and `node-transcript-scroll` lack local panel and overscroll containment.
- `packages/web/src/components/workflows/WorkflowDagViewer.tsx` alone owns the pictured runtime minimap.

## Selected solution

Use existing contracts and native CSS.
Add delta metadata at the two provider bridges.
Add one exact schema-gated string-envelope projection in shared agent history.
Position the hidden labels locally and contain the Legacy room scroll chain.
Delete only the Legacy runtime minimap code.

## Rejected solutions

- Do not rewrite persisted transcript rows or structured node output.
- Do not merge adjacent rows that providers marked complete.
- Do not infer historical ACP fragments from provider names, punctuation, dates, or row length.
- Do not build a generic multi-field structured-object renderer in this fix.
- Do not intercept wheel events with JavaScript or apply a global body overflow rule.
- Do not remove workflow-builder minimaps.

## Cross-plan result

Issue 174, 175, 180, and 181 code is already merged on `develop`.
Their stale plan statuses do not block this plan.
The implementation must keep readable tool rows, Raw payloads, occurrence boundaries, saved scroll state, and the queue composer behavior green.
