---
phase: 1
title: 'Phase 1: Shared raw contract and red outside-in tests'
status: pending
priority: P1
effort: '3h'
dependencies: []
---

# Phase 1: Shared raw contract and red outside-in tests

## Overview

Define, test, and implement the one shared piece of Story 1.2 — the pure raw-payload serializer — and rewrite the outside-in E2E expectations to the Raw contract so Phase 2 has a red goal on both surfaces. `formatToolIo` becomes dead once the bridges go; it is deleted in Phase 2 step 20, after its last two importers are rewritten, so type-check never goes red across the phase boundary.

## Requirements

- Functional: `toolRawPayloadJson({ name, input, output })` returns the pretty-printed JSON the Raw box shows; it is the only serializer the transcript uses.
- Functional: the six E2E sites express the Raw contract (hidden output when closed; visible after summary → Raw; full-output control count 1 in any Raw state; Tab order summary → Raw).
- Non-functional: pure, React-free, deterministic, never throws; no new dependency; zero ESLint warnings.

## Architecture

```text
lib/tool-presentation.ts
  export interface ToolRawPayload { name: string; input: unknown; output: unknown }
  export function toolRawPayloadJson(payload: ToolRawPayload): string
```

Behaviour:

1. Build `{ name, input, output }` in that key order from the item's untouched fields. Do not strip the Codex wrapper, do not normalize provider shapes, do not include `toolUseId`/`messageId` (the `<details data-tool-id>` already carries the id).
2. Return `JSON.stringify(object, null, 2)`. `undefined` members are omitted by `JSON.stringify`; `null` is kept; a string output serializes as a JSON string.
3. Wrap in `try/catch`. Persisted payloads are Zod-parsed JSON and always serialize; the catch is a fail-closed guard for an unrepresentable value (BigInt, cycle) so one row can never crash the transcript. On failure return `JSON.stringify({ name, error: 'payload is not serializable' }, null, 2)`. Comment the guard with this reasoning.

`pair-tool-transcript.ts`: `formatToolIo` (lines 75-78) and its `describe` in `pair-tool-transcript.test.ts:95-102` are deleted in **Phase 2 step 20**, not here — its four call sites are the two bridges Phase 2 rewrites, and deleting it first would break type-check.

## Related Code Files

- Modify: `packages/web/src/lib/tool-presentation.ts`
- Modify: `packages/web/src/lib/tool-presentation.test.ts`
- Read-only in this phase (deleted in Phase 2): `packages/web/src/lib/pair-tool-transcript.ts`, `packages/web/src/lib/pair-tool-transcript.test.ts`
- Modify: `e2e/ui/workflow-run-hitl.spec.ts`
- Modify: `e2e/ui/workflow-run-hitl-room.spec.ts`
- Modify: `e2e/ui/agent-tool-row-visual.spec.ts`

## Implementation Steps

### Red first — unit table for the helper

1. In `tool-presentation.test.ts` add `describe('toolRawPayloadJson')` with one table (`test.each`) covering:
   - key order: output starts with `{\n  "name":` then `"input":` then `"output":`;
   - Codex wrapped name `/bin/zsh -lc 'npm test'` appears verbatim in the JSON (`toContain('/bin/zsh -lc')`) — the resolver strips it only for the headline;
   - `output: undefined` → no `"output"` key; `output: null` → `"output": null`;
   - string output `'line1\nline2'` → serialized as `"line1\\nline2"` (a JSON string, not raw text — owner decision 2026-09-18: Raw is the persisted JSON for every shape);
   - object input `{ file_path: 'a.ts' }` → pretty-printed with two-space indent, `"file_path": "a.ts"`;
   - never throws: input containing a `BigInt` (`{ n: 1n }`) returns a string that contains the tool name and `not serializable` and does not throw.
2. Run `cd packages/web && bun test src/lib/tool-presentation.test.ts` — expect the new table red (helper missing).

### Red — E2E contract (stays red until Phase 2)

3. `e2e/ui/workflow-run-hitl.spec.ts:97-98` and `:123-124`: replace the two `getByText('Input'|'Output')` hidden assertions with `await expect(rows.getByText(HITL_TOOL_OUTPUT)).toBeHidden();` and, on the collapsed rows, `await expect(rows.locator('button[aria-expanded]').first()).toHaveAttribute('aria-expanded', 'false')`. Do not assert the Raw button is absent — inside a closed `<details>` it is hidden, not absent.
4. `e2e/ui/workflow-run-hitl-room.spec.ts:180-182`: after clicking the first summary, replace the `Output` click with `await room.getByRole('button', { name: 'Raw' }).first().click();` and keep `await expect(room.getByText(HITL_TOOL_OUTPUT)).toBeVisible(...)`. Rewrite the comment: "Output sits behind the row's closed Raw toggle — open the row, then Raw."
5. `e2e/ui/workflow-run-hitl-room.spec.ts:249-250`: replace the hidden `Input`/`Output` assertions with `toBeHidden()` on `toolRow.getByText(HITL_TOOL_OUTPUT)` and `toHaveAttribute('aria-expanded', 'false')` on `toolRow.locator('button[aria-expanded]')`.
6. `e2e/ui/workflow-run-hitl-room.spec.ts:643-654`: delete the `Output` click; keep the summary click; keep the existing `toHaveCount(0)` on the tail text (`:649`); assert `View full output` `toHaveCount(1)` **without** opening Raw (proves the control is reachable in any Raw state); click it; wait for the deterministic post-load signal — the `truncated` badge leaving the row's summary (`await expect(lastRow.locator('summary')).not.toContainText('truncated')`), because the presentation rebuilds with `outputState: 'full'` only after the bytes arrive — and then assert the tail text is **still** `toHaveCount(0)` — the loaded bytes must stay hidden while Raw is closed; then open Raw (`lastRow.getByRole('button', { name: 'Raw' })`) and assert the tail text is visible. Fix the comment at `:642-643`: the button lives inside the row's closed disclosure, not inside an Output diagnostic.
7. `e2e/ui/agent-tool-row-visual.spec.ts:376-378`: replace the `Input`/`Output` hidden lines with `await expect(row.locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'false')`; keep the `HITL_TOOL_OUTPUT` hidden line at `:378`.
8. `e2e/ui/agent-tool-row-visual.spec.ts:519-523`: point the Tab-order assertion at `row.getByRole('button', { name: 'Raw' })` instead of the `Input` summary; message "Tab follows DOM order into the Raw button". In the same open-row section add: bounding-box height of the Raw button ≥ 24 (reuse the spec's existing `boundingBox` pattern at `:101-128`), and a focus-outline colour check on the Raw button reusing the summary's `focus` evidence pattern (`:489-505`). Then press the button and assert the box appears with `HITL_TOOL_OUTPUT` visible and the button reads `Raw ▾`; resolve `aria-controls` with `locator.evaluate(el => document.getElementById(el.getAttribute('aria-controls') ?? '') !== null)` — never `'#' + id`; press again and assert the box is gone. Any screenshot or evidence captured with Raw open shows only the synthetic fixture strings from `e2e/lib/playwright/archon-runtime.ts:44`; do not copy this capture onto a spec that runs production-shaped data.
9. Run the E2E type-check the repo uses for `e2e/` — it must compile even while red.

### Green — implement the helper

10. Add `ToolRawPayload` and `toolRawPayloadJson` to `tool-presentation.ts` next to the other exported presenter helpers; export both. Keep the module React-free.
11. Run `cd packages/web && bun test src/lib/` — green. (`formatToolIo` stays until Phase 2 step 20.)

## Success Criteria

- [ ] `toolRawPayloadJson` unit table passes; every row asserts on a string and none throws.
- [ ] The six E2E sites reference `Raw`, `aria-expanded`, and `HITL_TOOL_OUTPUT` — no `getByText('Input'|'Output')` remains in `e2e/ui/`.
- [ ] E2E and Web type-checks compile.

## Risk Assessment

- **String outputs gain an escape pass.** `formatToolIo` returned a string output verbatim; the helper JSON-encodes it, so a loaded multi-megabyte stdout is escaped synchronously on the main thread when Raw opens (the detail route has no size cap — `packages/server/src/routes/api.ts:5321-5342`). This is bounded by the operator's own click and happens once per open, whereas the bridge serialized every row on every render; net cost is lower for objects and higher only for very large strings. Accepted by the owner (2026-09-18) with pure JSON as the Raw shape. Signal it broke: visible jank when opening Raw on a loaded row in the visual sweep. Response: memoize the string per `(fullOutput, item.output)` pair before adding any size threshold.
- **`JSON.stringify` returns `undefined` for a bare `undefined`.** Impossible here because the argument is always an object; the return type stays `string`.
- **E2E red for a whole phase.** Expected under outside-in TDD; land Phases 1 and 2 in one PR. CI's `e2e-hitl` job does not run on PRs into `develop` (`.github/workflows/test.yml:5-7` lists `[main, dev]`); by owner decision (2026-09-18) `test.yml` stays untouched and the red-then-green proof is the recorded local run.
