---
title: "Phase 4: Web docks — 30-min disclosure + keepalive"
status: todo
---

# Phase 4: Web docks — 30-min disclosure + keepalive

## Context links

- Scout: `plans/reports/scout-260920-1843-web-docks.md` (both shells, anchors).
- `control-states.md` (idle-after-interrupt row: *"Typing in the composer keeps the node open"*);
  `steering-test-plan.md` accessibility bullets.

## Overview

Two shells render the dock, thin and twice: Legacy (`packages/web/src/components/workflows/
ComposerDock.tsx`) and Console (`packages/web/src/experiments/console/components/
ConsoleComposerDock.tsx`). Add (a) a shared disclosure string stating the 30-minute limit and
that typing keeps the node open, rendered at each shell's existing `idle` gate; and (b) a
debounced authenticated keepalive fired on keystroke/focus **only while idle** — never on
`Send now`, never from the finished-iteration read-only dock.

## Key insights

- `idle` gate (both shells): `agentMode = steeringAgentMode(dock)` (`steering-dock.ts:177-185`)
  then `idle = agentMode === 'idle'` — `ComposerDock.tsx:515,742`, `ConsoleComposerDock.tsx:521,748`.
  No separate mode; idle-after-interrupt is a sub-state of `composer` mode driven by
  `dock.subState`.
- Existing disclosure render site: `{idle ? <p>{STEERING_INTERRUPT_DISCLOSURE}</p> : null}` —
  Legacy `:823-827`, Console `:829-833`. `STEERING_INTERRUPT_DISCLOSURE` and the "Send now"/"Will
  send" copy live centralized in `steering-dock.ts:102-105` — extend/append there so both shells
  inherit it (single source of truth).
- Keystroke handler: `onChange` (`ComposerDock.tsx:836-838`, `ConsoleComposerDock.tsx:842-844`).
  Focus: `onFocusCapture`/`onBlurCapture` on the well div (`:807-820` / `:813-826`) — currently
  only tracks `focusInsideRef`; the attach point for "focus re-arms."
- Steering client API calls share one shape (`web/src/lib/api.ts:762-864`): URL template +
  `fetchJSON` + `toSteeringRequestError`, typed off `@/lib/api.generated`. Add a fifth
  `keepaliveWorkflowNode(...)` in the same shape (uses the Phase-3 generated type).
- **No shared debounce util exists** — use the established inline `useRef<setTimeout>` pattern
  (precedent `routes/DashboardPage.tsx:69,135-138`).
- The existing 1s `startQueuePolling()` (`steering-dock.ts:802-868`) is a **read** poll — not
  keepalive; do not conflate. A distinct event-gated debounced keepalive is required.
- 2.11 reconciliation (`hasTerminalNodeEvidence`, `execution-room-model.ts:453-463`, 3s poll) is
  generic to terminal node status — the 30-min fail terminal flows through it automatically (see
  Phase 5); **no client change here for NEVER SENT.**

## Requirements

- [ ] `steering-dock.ts`: one shared accessible disclosure string (extend
      `STEERING_INTERRUPT_DISCLOSURE` or add a companion consumed at the same render site) stating
      the 30-minute inactivity limit and that typing/composing keeps the node open. Visible text,
      **not** a tooltip.
- [ ] `web/src/lib/api.ts`: `keepaliveWorkflowNode(runId, nodeId)` client call (Phase-3 type).
- [ ] Both docks: a debounced keepalive fired from `onChange` and `onFocusCapture`, **gated on
      `agentMode === 'idle'`**, using an inline `useRef<setTimeout>` debounce (leading-edge or
      trailing with a short window, e.g. ≤ 2s), shared thin between shells.
- [ ] Keepalive is **never** fired on `Send now`, on `Queue`, on a `generating` dock, or from the
      finished-iteration read-only dock (no mutations there — `control-states.md`).

## TDD — Tests Before

`steering-dock.test.ts` (state/copy) + `ComposerDock.test.tsx` + `ConsoleComposerDock.test.tsx`:

1. When the dock is idle-after-interrupt, the disclosure text is present and mentions the 30-min
   limit + that typing keeps it open; it is real visible text (queryable by role/text, not only
   `title`); absent when generating/finished.
2. Typing in the composer while idle fires the keepalive client call (debounced — N keystrokes in
   the window collapse to ≤1 call); focusing the composer while idle fires it.
3. `Send now` does **not** fire keepalive; typing/focus while `generating` does **not** fire it;
   the finished-iteration read-only dock fires **no** keepalive (and no send/withdraw/interrupt).
4. Accessibility: the disclosure participates in the existing live-region/aria pattern (per-
   transition polite announcement unaffected; focus handling unchanged — never `<body>`).
5. Both shells assert the same behavior (Console imports nothing from `@/components/`).

## Refactor

- Factor the "should keepalive now?" decision + debounce into the shared `steering-dock.ts` helper
  layer so both shells call one thin function (avoid divergent per-shell logic).

## TDD — Tests After

- Items 1–5 pass on both shells; existing dock-state tests (generating/interrupting/finished/
  NEVER SENT) stay green.

## Todo

- [ ] Write dock/copy tests (1–5); run — fail.
- [ ] Add the shared disclosure string + shared keepalive-decision helper in `steering-dock.ts`.
- [ ] Add the `keepaliveWorkflowNode` client call.
- [ ] Wire `onChange`/`onFocusCapture` in both shells (debounced, idle-gated).
- [ ] Green dock tests.

## Success criteria

- [ ] `bun test packages/web/src/lib/steering-dock.test.ts` and the two dock test files green.
- [ ] `bun --filter @archon/web type-check` clean; `@archon/web` imports nothing from
      `@archon/workflows`.

## Regression gate

```
bun test packages/web/src/lib/steering-dock.test.ts
bun test packages/web/src/components/workflows/ComposerDock.test.tsx
bun test packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx
bun --filter @archon/web type-check
```

## Risk assessment

- Keepalive firing while generating or from the finished dock would violate `control-states.md`'s
  no-mutation rule — the idle gate + explicit negative tests guard this.
- Un-debounced keepalive would flood the route on every keystroke — the debounce test caps it.

## Security considerations

- Keepalive rides the authenticated steering route family; no message content leaves the browser.

## Next steps

Phase 5 proves the automatic ACs (NEVER SENT at expiry, retry fresh session) and runs the full
validation gate.
