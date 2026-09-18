# Story 1.2 — Visual Acceptance Supplement: Raw Payload Toggle

Issue #175 / `raw-payload-toggle` Story 1.2 (US-003). Supplements the Story 1.1
row-shell report at
`plans/260917-1011-issue-174-readable-tool-call-row/reports/visual-acceptance.md`
with verification of the single `Raw` disclosure that replaces the temporary
nested `Input`/`Output` bridge disclosures on both surfaces.

**Evidence sources**

- `e2e/ui/agent-tool-row-visual.spec.ts` — surface loop over `console` and
  `legacy`, all passing (Chromium, @playwright/test 1.60.0). Captures written
  to `evidence/` beside this report and attached via `testInfo`.
- `e2e/ui/workflow-run-hitl.spec.ts` — collapsed-contract cases on both
  surfaces (closed Raw, no payload markup while collapsed).
- `e2e/ui/workflow-run-hitl-room.spec.ts` — Legacy open-Raw canonical-payload
  case, Console default-history closed-Raw case, and the Console long-history
  journey (`e2e-hitl-long-history`, 20,000-char output tail).
- Real fixtures only: `e2e-hitl-run` / `e2e-hitl-long-history` stored
  workflows, fake provider `Read` (`HITL_TOOL_INPUT.txt` →
  `HITL_TOOL_OUTPUT`); no credentials or customer payloads.

## 1. Closed-state contract (both surfaces)

Asserted while the outer row is collapsed and again after the row opens:

- Exactly one `button[aria-expanded]` per row — the `Raw` control — present in
  the DOM but hidden inside the collapsed row (`getByRole` intentionally not
  used there: hidden details children are absent from the accessibility tree).
- `aria-expanded="false"`, no `aria-controls` while closed.
- Zero nested `<details>` inside the row (the Input/Output bridge is gone) and
  zero `<pre>` elements — the serialized payload is not mounted until asked.
- `HITL_TOOL_OUTPUT` is absent from the row's DOM while Raw is closed.

## 2. Raw anatomy and interactive states (computed styles, both surfaces)

| Element             | Contract                                      | Measured                                                                     | Result |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Control placement   | body bar, pinned right after left-side facts  | facts left edge = bar left edge; Raw right edge within 2px of bar right edge | ✅     |
| Target size         | ≥ 24px                                        | 24px height                                                                  | ✅     |
| Closed label/border | `--text-secondary` on quiet `--border`        | secondary + quiet on both surfaces                                           | ✅     |
| Hover label/border  | `--text-primary` on `--border-bright`         | primary + bright on both surfaces                                            | ✅     |
| Focus label/border  | `--text-primary` on `--border-bright`         | primary + bright on both surfaces                                            | ✅     |
| Focus ring          | 2px solid `--accent-bright`, `:focus-visible` | `solid 2px` + accent resolved on both surfaces                               | ✅     |
| Open label/border   | `--text-primary` on `--border-bright`         | primary + bright on both surfaces                                            | ✅     |
| Panel surface       | `--surface-inset` background                  | matches resolved token on both surfaces                                      | ✅     |
| Panel text          | `--text-primary`, 11.5px/1.5 mono             | `11.5px`, `17.25px`, primary on both surfaces                                | ✅     |

**Verification repair recorded:** the first run caught a real renderer defect —
Console's unlayered `.console-root * { border-color: var(--border) }` wildcard
(`theme.css`) repaints every layered border utility, so the Raw toggle's
hover/focus/open bright border could never appear on Console (Legacy was
unaffected; color utilities are unpinned). A scoped unlayered rule for
`details[data-tool-id] button[aria-expanded]:is(:hover, :focus-visible,
[aria-expanded='true'])` restores the intended border states, matching how
StreamCard/ProjectRow/MessageItem already work around the same wildcard.
Confirmed by the passing computed-style assertions above.

## 3. Canonical payload

With the row open and Raw opened once, the `<pre>` text parses as JSON with
top-level keys in order `name`, `input`, `output`, and values:

```json
{ "name": "Read", "input": { "path": "HITL_TOOL_INPUT.txt" }, "output": "HITL_TOOL_OUTPUT_VISIBLE" }
```

(pretty-printed `toolRawPayloadJson(presentation.rawPayload)` output; provider
tool name and original values preserved.) The toggle's `aria-controls` equals
the panel's DOM `id`, resolved via `document.getElementById` (React `useId()`
ids contain punctuation unsafe for CSS selectors). First click mounts the
panel; second click removes it entirely — no serialized payload remains in the
DOM.

## 4. Keyboard + Chromium AX-tree evidence

- `Tab` after the summary reaches the Raw control next (DOM order); Enter and
  Space each toggle it; the accent focus ring stays visible throughout.
- `summaryAxEvidence`/`rawAxEvidence` over CDP `Accessibility.getFullAXTree`,
  nodes matched by `backendDOMNodeId` inside this row's scope:
  - closed: AX node `role=button`, `name="Raw"`, `expanded=false`, no controls
    target.
  - open (polled — Chromium updates the tree lazily): `expanded=true` and the
    `controls` relationship resolves to this row's `<pre>` (accepts both
    `relatedSources` and `idref` protocol encodings).
- No axe dependency added.

## 5. Long-history journey (Console, `e2e-hitl-long-history`)

- `View full output` is offered on the expanded last row before Raw opens;
  clicking it issues `GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages/{id}`
  → `200`.
- The 20k output tail (`[e2e-fake] full output tail`) stays out of the DOM
  while Raw is closed even after the fetch, then appears inside the panel once
  Raw opens.
- Raw panel `scrollWidth - clientWidth` ≤ 1px and page `documentElement`
  overflow ≤ 1px with the long payload open.
- Evidence: `evidence/console-long-raw-open.png`.

## 6. Viewport sweep + zoom

`1440×1000`, `1024×900`, `768×900`, **`460×900`** (added this story — the UX-
canonical room width), `390×844`, and 200%-zoom emulation on both surfaces.
Each step opens the row **and** Raw, then asserts the room/page overflow
contract (`expectNoRoomDrivenOverflow`) — all pass.

## 7. Contrast (resolved through the real page canvas)

`evidence/raw-toggle-contrast.json`:

| Tone                                                  | Console | Legacy | Floor  |
| ----------------------------------------------------- | ------- | ------ | ------ |
| Closed label (`--text-secondary`) vs body bar         | 8.37    | 6.14   | 4.5 ✅ |
| Hover/focus/open label (`--text-primary`) vs body bar | 17.72   | 16.23  | 4.5 ✅ |
| Raw JSON (`--text-primary`) vs inset panel            | 18.77   | 16.52  | 4.5 ✅ |

## 8. Source-artifact comparison

The rendered payload is the canonical `presentation.rawPayload` pair —
provider-facing `name` plus parsed `input`/`output` — identical on Legacy and
Console by shared construction (US-001 serializer), asserted from live DOM on
both surfaces. The implementation matches `key-transcript-states.html` §F:
facts remain left in the body bar, `Raw` stays at the far right, the open state
adds the `▾` marker, and the JSON replaces the body slot in an inset bordered
box. The shipped JSON uses `text-primary`, following `DESIGN.md`'s structured
`body-box` binding; that authoritative binding intentionally overrides §F's
older inline `text-tertiary` annotation. The reviewed 460px and desktop
captures show the same structure on Legacy and Console without horizontal
overflow.

## 9. Evidence files

- `evidence/console-raw-closed-460.png`, `evidence/console-raw-open-460.png`,
  `evidence/console-raw-open-1440.png`
- `evidence/legacy-raw-closed-460.png`, `evidence/legacy-raw-open-460.png`,
  `evidence/legacy-raw-open-1440.png`
- `evidence/console-long-raw-open.png` (long-history tail inside open Raw)
- `evidence/raw-toggle-contrast.json`

## 10. Manual assistive-technology pairings

Same environment limits as the Story 1.1 report §10 — no Windows/NVDA runtime
and no macOS AX-automation grant are available in this session. Story 1.2's
required proof is the automated Chromium AX channel (§4), which passed; spoken
wording remains an optional human spot-check, tracked under the Story 1.1
report's standing manual-AT note rather than re-opened here.

## Result

**PASS.** All migrated specs pass in `bun run --cwd e2e test:ui:hitl` (36
passed, 3 environment skips), `bun run --cwd e2e typecheck` is clean, and the
stale-bridge search over `packages/web/src` + `e2e/ui` finds only the
intentional `not.toContain('>Input<' | '>Output<')` regression guards in
`NodeRoom.test.tsx` — negative assertions proving the old bridge labels are
absent, which is the contract itself.
