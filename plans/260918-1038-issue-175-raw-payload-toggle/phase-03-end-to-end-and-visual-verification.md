---
phase: 3
title: 'Phase 3: End-to-end and visual verification'
status: pending
priority: P1
effort: '3h'
dependencies: [1, 2]
---

# Phase 3: End-to-end and visual verification

## Overview

Turn the Phase 1 E2E contract green against a real HITL run on both surfaces, add the Raw-specific geometry, focus, contrast, and reduced-motion evidence, do the scoped visual and screen-reader reviews, and run every repository gate. Produces `reports/visual-acceptance.md`.

## Requirements

- Functional: the three HITL specs pass on Legacy and Console with the Raw contract; `bun run validate` passes.
- Non-functional: WCAG 2.2 AA evidence for the new control and box (target size, contrast, focus, label-in-name, reduced motion); no horizontal scroll at 460 px or 390 px; 200 % zoom stays operable.

## Architecture

Evidence sources, in order: Playwright assertions (deterministic), Playwright-attached screenshots (human comparison against mockup §F), computed-style/AX evidence written into the spec's evidence JSON (the `agent-tool-row-visual.spec.ts` pattern), and a manual screen-reader record.

## Related Code Files

- Modify: `e2e/ui/agent-tool-row-visual.spec.ts` (Raw evidence block; reuse the existing helpers)
- Verify: `e2e/ui/workflow-run-hitl.spec.ts`, `e2e/ui/workflow-run-hitl-room.spec.ts`, `e2e/ui/workflow-run-hitl-visual.spec.ts`
- Create: `plans/260918-1038-issue-175-raw-payload-toggle/reports/visual-acceptance.md`

## Implementation Steps

1. Run the E2E type-check, then the three HITL specs for both surfaces locally with `bun run --cwd e2e test:ui:hitl` (it greps uppercase `HITL` titles — keep titles in that form). All Phase 1 sites must now be green. Record the run's summary in the PR: CI's `e2e-hitl` job (`.github/workflows/test.yml:71-117`) only triggers on `[main, dev]` and this fork's PRs land on `develop`; by owner decision the local run is the gate and `test.yml` is not touched in this story.
2. In `agent-tool-row-visual.spec.ts`, inside the existing open-row evidence section for each surface, add and attach:
   - Raw button bounding box ≥ 24 px tall, computed `border-color` equals the resolved `--border`, `color` equals `--text-secondary`; after `focus()`, outline colour equals `--accent-bright` and `border-color` equals `--border-bright`.
   - After activation: text `Raw ▾`, `aria-expanded="true"`, and the `aria-controls` relationship resolves — via `button.evaluate(el => document.getElementById(el.getAttribute('aria-controls') ?? ''))`, never `locator('#' + id)`, because React 19 `useId` ids contain characters CSS selectors reject — to a `<pre>` whose computed `background-color` equals `--surface-inset`, `white-space` is `pre-wrap`, and whose box is no wider than the room.
   - Every capture with Raw open (screenshot, evidence JSON, AX dump) shows only the synthetic HITL fixture strings; this evidence pattern is not to be copied onto any spec that runs production-shaped payloads.
   - Room `scrollWidth <= clientWidth` at 460 px with Raw open on the widest fixture row; no summary wraps (reuse `expectSummaryOneLine`).
   - `prefers-reduced-motion: reduce` emulation: chevron transition still `none`; the Raw box appears without animation (it is a conditional render, so assert no `transition` on the `<pre>`).
   - AX evidence: the Raw button's accessible name is `Raw` (not `Raw ▾`), role `button`, `expanded` true/false toggles.
   - Contrast: measure Raw button text (text-secondary) on `surface`, and JSON text (text-primary) on `surface-inset`, on both surfaces; write to the evidence JSON alongside the existing tool-row contrast numbers; each must clear 4.5:1.
3. Extend the viewport sweep (1440/1024/768/390 + 200 % zoom) so that, with the row open and Raw open, the room has no horizontal scroll and the button stays ≥ 24 px.
4. Manual visual comparison against mockup §F, both surfaces: bar layout (facts left, Raw right), button style closed/hover/focus/open, box style. Record only 1.2-owned properties; list the empty presented body and the missing family arms as expected differences.
5. Manual screen-reader check on one Windows pairing and one macOS pairing: summary announces state → tool → target → facts; `Tab` lands on `Raw, button, collapsed`; activation announces `expanded`; JSON is readable inside the box; `View full output` is next. Record pairings and results.
6. Run `cd packages/web && bun run test && bun run type-check`, root `bun run lint --max-warnings 0`, `bun run format:check`, then `bun run validate`. Never run root `bun test`.
7. Write `reports/visual-acceptance.md`: mockup comparison, sweep table, contrast numbers, target size, keyboard/AX evidence, screen-reader records, gate results, and expected differences.
8. Open the PR from the repo template with `Closes #175`; include the evidence report path and the interim-body note. Sprint status moves to `done` only through its owning BMad workflow after merge.

## Success Criteria

- [ ] All three HITL specs green on Legacy and Console; the visual spec's new Raw evidence attached.
- [ ] Contrast ≥ 4.5:1 for Raw text and JSON text on both surfaces; Raw button ≥ 24 px; accessible name `Raw`.
- [ ] No horizontal scroll with Raw open at 460 px and across the sweep; reduced motion honoured.
- [ ] Two screen-reader pairings recorded.
- [ ] `bun run validate` green; report written; PR opened against the working branch with the template.

## Risk Assessment

- **Wide JSON lines.** A long unbroken token (URL, base64) could widen the box. Mitigation: `pre-wrap` + `overflow-wrap: anywhere` in Phase 2; this phase asserts `scrollWidth <= clientWidth`. Signal: assertion fails → add `max-width: 100%`/`min-width: 0` on the box before touching the room.
- **CI HITL job selection.** Titles must keep the uppercase `HITL` token or the grep silently skips them. Signal: the local run lists fewer HITL tests than expected → fix the title.
- **CI does not run the HITL suite on `develop`.** `test.yml:5-7` triggers on `[main, dev]`; the fork's PRs land on `develop`. A regression in the six rewritten sites would merge green. Mitigation: the recorded local run is a required PR checklist item (owner decision 2026-09-18: `test.yml` untouched here; trigger fix is a separate follow-up). Signal: a later HITL failure found only after merge → escalate the trigger fix.
- **Contrast of text-primary JSON on `surface-inset`.** DESIGN measures text-primary on `surface` well above AA; this phase measures it on `surface-inset` for both surfaces. Signal: below 4.5:1 on either surface → switch that surface's `RAW_TEXT_CLASS` to `text-text-secondary` (DESIGN `:471`, 6.3:1 / 8.9:1) and record the deviation.
