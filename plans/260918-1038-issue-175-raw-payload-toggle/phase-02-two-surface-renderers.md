---
phase: 2
title: 'Phase 2: Legacy and Console renderers'
status: pending
priority: P1
effort: '5h'
dependencies: [1]
---

# Phase 2: Legacy and Console renderers

## Overview

Replace the temporary Input/Output disclosures in both `ToolHistory` components with the final Raw toggle and a conditionally rendered raw body box, keeping the full-output flow exactly where it is. Red component tests first on both surfaces, then Legacy, then Console. Neither surface imports the other; the only shared code is `toolRawPayloadJson`.

## Requirements

- Functional: body bar = `family · facts` on the left, `Raw` button on the right; Raw closed by default; open swaps in the raw box and reads `Raw ▾`; the JSON string is absent from the DOM while closed.
- Functional: `View full output`, inline error, and `Retry` render once, after the swap slot, in any Raw state; a loaded output updates both the badges and an open raw box in place.
- Functional: Raw state is per-row, independent of `open`/`touched`, survives polling and loads, resets on a new item identity.
- Non-functional: strict TypeScript, no `any`, zero ESLint warnings, tokens from each surface's existing utility set, no new design token.

## Architecture

### Required DOM contract (both surfaces, identical anatomy)

```tsx
<details data-tool-id={item.toolUseId} open={open} onToggle={onToggle}>
  <summary>…unchanged Story 1.1 row…</summary>
  <div className="mb-2 ml-[29px] mt-0.5 border-l-2 border-border pl-2.5">
    <div className="mb-1.5 flex items-center gap-2 font-mono text-[10.5px] text-text-secondary">
      <span>{[presentation.family, ...facts].join(' · ')}</span>
      <button
        type="button"
        aria-expanded={rawOpen}
        aria-controls={rawOpen ? rawId : undefined}
        onClick={() => setRawOpen(v => !v)}
        className="ml-auto inline-flex min-h-[24px] items-center rounded-[4px] border border-border bg-transparent px-[7px] py-px font-mono text-[10.5px] text-text-secondary hover:border-border-bright hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-bright … aria-expanded:border-border-bright aria-expanded:text-text-primary"
      >
        Raw{rawOpen ? <span aria-hidden="true"> ▾</span> : null}
      </button>
    </div>
    {rawOpen ? (
      <pre id={rawId} className={`m-0 overflow-hidden whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[6px] border border-border bg-surface-inset px-2.5 py-2 font-mono text-[11.5px] leading-normal ${RAW_TEXT_CLASS}`}>
        {toolRawPayloadJson({ name: item.name, input: item.input, output: hasFullOutput ? fullOutput : item.output })}
      </pre>
    ) : null}
    {item.canLoadFullOutput ? <button …>View full output</button> : null}
    {loadError !== null ? <div …>{loadError}<button …>Retry</button></div> : null}
  </div>
</details>
```

Notes:

- `rawId` comes from `useId()` — `ConsoleAgentHistoryList` mounts twice on one page, so an id built from `toolUseId` alone can collide. `aria-controls` is set only while the box is rendered; a closed button must not reference an id that is absent from the DOM (`DagNodeProgress.tsx:111,143` leaves its reference dangling when collapsed — do not copy that).
- The `▾` suffix is `aria-hidden` so the accessible name is exactly `Raw` (SC 2.5.3 label-in-name) and `aria-expanded` carries the state.
- The body bar switches from `items-baseline` to `items-center` so the 24 px button centres against the 10.5 px facts; the painted box of the facts is unchanged.
- Focus offsets stay surface-specific: `focus-visible:-outline-offset-2` on Legacy, `focus-visible:outline-offset-2` (with the existing `!` accent override) on Console — mirror what each `<summary>` already uses.
- Legacy may use `cn()`; Console must keep string concatenation (it does not import `@/lib/utils` today — verify with the Console isolation test before adding any import).
- `RAW_TEXT_CLASS = 'text-text-primary'` is one unexported module-level constant per surface (owner decision 2026-09-18, per the `body-box` token binding), so the colour stays a one-token change; tests assert the literal `text-text-primary` on the rendered `<pre>`. The `<pre>` renders only the helper's JSON string — one shape for every payload.
- The presented-body slot between the bar and the full-output control is intentionally empty in 1.2; Story 1.3 fills it. Do not render a placeholder or `awaiting output` here.
- **Keep** the `event.target !== event.currentTarget` guard in `onToggle`; only rewrite its comment so it states the invariant rather than its origin: "Only this row's own disclosure toggle counts — a nested disclosure's toggle bubbles here and must never mark the row touched or change its open state." Later stories put collapsible cards inside this body (subtask cards), so the guard stays load-bearing. Keep the controlled-`open` echo comparison exactly as is.
- Remove the `formatToolIo` import from both files; step 20 then deletes the function and its test.

### Raw state algorithm

- `const [rawOpen, setRawOpen] = useState(false)` per `ToolHistory` instance; the instance is keyed by the existing stable item id, so polling re-renders keep it and a new identity starts closed.
- Toggling Raw never touches `open`, `touched`, `fullOutput`, `loadError`, or `loading`.
- The raw box reads `hasFullOutput ? fullOutput : item.output` on every render, so a running row whose result pairs later, or a row whose full output loads, updates the open box in place.
- The JSON string is computed inside the `rawOpen` branch only.
- **Load resolution guard.** In `loadFull`'s `.then`, when the resolved output is `undefined` (Legacy: `message.kind !== 'tool'`; Console: `onLoadFullOutput` resolved `undefined` because its caller saw a non-tool row — `ConsoleNodeRoom.tsx:748-751`, `ConsoleExecutionHistory.tsx:303-306`), call `setLoadError('Full output is not available for this call')`, leave `hasFullOutput` false and the `truncated` badge in place, and stop. A loadable row always has a stored output, so `undefined` can only mean the wrong row came back; silently marking it `full` and letting Raw omit `output` would be the exact wrong answer for a diagnostic control. The three caller files stay untouched.

## Related Code Files

- Modify first: `packages/web/src/components/workflows/NodeRoom.test.tsx`
- Modify first: `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`
- Modify first: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`
- Verify: `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx`
- Modify after red: `packages/web/src/components/workflows/NodeRoom.tsx`
- Modify after red: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`
- Delete now: `formatToolIo` in `packages/web/src/lib/pair-tool-transcript.ts` + its `describe` in the test
- Verify only: `packages/web/src/experiments/console/console-isolation.test.ts`

## Implementation Steps

### Red — Legacy static anatomy (`NodeRoom.test.tsx`)

1. `:283-285` (loaded markup): replace `toContain('Input')` / `toContain('Output')` with `toContain('aria-expanded="false"')` and `toContain('>Raw<')` (or a regex tolerant of whitespace); keep `View full output` and `truncated`.
2. `:383-384` (collapsed summary): keep the no-punctuation assertions; replace `not.toContain('>Input<')` with `not.toContain('Raw')` on the **summary** substring only.
3. `:582-615` rename to `opened body starts with the family then every summary fact, and the Raw toggle is a closed control at the bar's end`: assert the bar contains the family-first fact string and one `<button … aria-expanded="false" …>Raw</button>` carrying `min-h-[24px]`, `border-border`, `text-text-secondary`, `focus-visible:outline-accent-bright`, and no `aria-hidden`; assert the body markup contains **no** `<details`, no `>Input<`, no `>Output<`, and no serialized key from the fixture (`"path":`, `"name":`); assert `View full output` appears **after** the button in the markup. In the open-box case, assert the `<pre>` carries `text-text-primary`, `bg-surface-inset`, `whitespace-pre-wrap`, and the id named by the button's `aria-controls`; in the closed case assert the button has no `aria-controls` attribute.
4. Add `no serialized JSON is in the room DOM while every Raw is closed`: render the mixed fixture (success + failed auto-opened + truncated), take `host.innerHTML`, assert it does not match `/"(name|input|output)":\s/` and does not contain any fixture payload value that only exists in `input`/`output`.

### Red — Legacy interaction (`LegacyNodeRoom.test.tsx`)

5. `:1128-1129`: replace `Input`/`Output` presence with `rowButton(row, 'Raw')` present and `aria-expanded === 'false'`.
6. `:1281-1308` rename to `Raw toggles its box without marking the outer row touched`: open the row, click `Raw` → `<pre id>` exists with `"name":`, button text `Raw ▾`, `aria-expanded="true"`, `aria-controls` equals the `<pre>` id; click again → the `<pre>` is gone and text is `Raw`; then re-render with a failed outcome and assert the automatic failure-open still fires (the row was never touched by the Raw click).
7. Add `Raw state survives polling re-renders and resets on a new tool identity`: open Raw, re-render with the same id and a changed duration badge → box still present and content unchanged; re-render with a different `toolUseId` → closed.
8. `:1330-1389` (full-output load): keep every existing assertion, and add: with Raw open before the click, the `<pre>` text switches from the truncated output to the loaded output and the `truncated` badge disappears; with Raw closed before the click, the button is still present and works (assert `rowButton(row, 'View full output')` resolves without opening Raw).
9. `:1390-1423` (failed load): keep; add that the summary text, the row's `open`, and `aria-expanded` on Raw are unchanged after the error and after `Retry`.
   9b. Add `a load that resolves to a non-tool message shows the error and keeps the row truncated`: mock `getWorkflowNodeMessage` to resolve a `kind: 'text'` row; after clicking `View full output`, assert the inline error text, `Retry` present, the `truncated` badge still present, and — with Raw open — the box still shows the original truncated output (no `"output"` key removed).
10. Add `Tab order inside an open row is summary → Raw → View full output` using the existing focus helpers: focus the summary, dispatch the DOM tab order by querying `row.querySelectorAll('summary, button')` in document order and asserting the sequence (jsdom cannot move focus on Tab; the real Tab is proven in E2E).

### Red — Console selected room (`ConsoleNodeRoom.test.tsx`)

11. `:262-300` (`renders agent text, tool JSON, …`): rename to `renders agent text, tool rows, status entries, …`; replace the closed-details loop and the two `"path": "a.ts"` / `"ok": true` assertions with: no `<details>` inside the row, `toolRowEl.textContent` does **not** contain `"path": "a.ts"`; click the summary, click `Raw`, then `toolRowEl.textContent` contains both `"path": "a.ts"` and `"ok": true`.
12. `:1063-1068`: replace the diagnostics loop with `bashRow.querySelector('button[aria-expanded]')` present with `aria-expanded="false"` and `bashRow.querySelectorAll('details')` length 0.
13. `:1328-1329`, `:1481-1508`, `:1620-1701`: mirror Legacy steps 5–9b with the Console helpers (`renderRoom` at `:231`, `flushUntil`, `rowButton`); for 9b, have the room's `loadMessage` resolve a `kind: 'text'` row so `onLoadFullOutput` resolves `undefined`.
14. Add the `no serialized JSON in the room DOM while Raw is closed` case and the identity-reset case on Console.

### Red — Console inline history (`ConsoleExecutionHistory.test.tsx`)

15. Add one assertion to the existing tool-row case: exactly one `button[aria-expanded="false"]` per tool row and no `<details>` inside a row. Two mounts on one page must yield distinct `aria-controls` ids — render the selected room and the inline history together where the existing tests already do and assert the two ids differ.

### Green — Legacy

16. Implement the DOM contract in `NodeRoom.tsx`: add `useId`, `rawOpen` state, the `RAW_TEXT_CLASS` constant, the bar layout, the button, the conditional `<pre>`, the load-resolution guard, remove the two `<details>`, remove the `formatToolIo` import, rewrite the `onToggle` guard comment.
17. Run `cd packages/web && NODE_ENV=development bun test src/components/workflows/` — green.

### Green — Console

18. Implement the same contract in `ConsoleAgentHistoryList.tsx` with string-concatenated classes and Console focus offsets; remove the bridge and the import.
19. Run `cd packages/web && NODE_ENV=development bun test src/experiments/console/` and `bun test src/experiments/console/console-isolation.test.ts` — green.

### Cleanup

20. Delete `formatToolIo` (`pair-tool-transcript.ts:75-78`) and its `describe` (`pair-tool-transcript.test.ts:95-102`) now that no importer remains. `grep -rn "formatToolIo\|>Input<\|>Output<" packages/web/src e2e` must return nothing.
21. `cd packages/web && bun run type-check && bun run test`; root `bun run lint --max-warnings 0`.

## Success Criteria

- [ ] Both surfaces: Raw closed by default for the five outcomes; open swaps in the box with the exact helper output; `Raw ▾` + `aria-expanded="true"` while open.
- [ ] No `<details>` inside a tool row; no `Input`/`Output` text; no serialized JSON in the DOM while Raw is closed.
- [ ] `View full output` count is 1 per loadable row in any Raw state; load and error/retry paths unchanged; open box updates in place; a load that resolves without a tool output surfaces as the inline error and never marks the row `full`.
- [ ] Raw click never marks the row touched; failure auto-open still works afterwards; state survives polling and resets on identity change; the bubbled-toggle guard remains with its invariant comment.
- [ ] Both Console mounts render distinct `aria-controls` ids; `console-isolation.test.ts` green.
- [ ] Web tests, type-check, and lint green.

## Risk Assessment

- **Interim empty presented body.** With Raw closed an expanded successful row shows only the body bar until Story 1.3. Accepted by the owner (2026-09-18) per EXPERIENCE `:113` (swap) and the epic's story split. Signal: 1.2 ships alone for more than one sprint → raise whether to pull the 1.3 generic key-value body forward.
- **Class name drift between surfaces.** The two files must carry the same anatomy with different focus offsets only. Mitigation: the two test files assert the same class tokens; the visual sweep in Phase 3 compares both.
- **Tailwind `aria-expanded:` variant availability.** If the project's Tailwind v4 setup does not expose `aria-expanded:` utilities, compute the open classes in JS (`rawOpen ? '…text-text-primary border-border-bright' : '…'`) instead of adding a plugin. Signal: the class has no effect in the E2E colour check → switch to the JS branch.
- **`useId` inside a list.** Hooks order is stable because `ToolHistory` is a component per item, not a loop body; no conditional hook.
