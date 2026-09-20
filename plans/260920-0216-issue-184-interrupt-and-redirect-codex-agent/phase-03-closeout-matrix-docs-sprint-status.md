---
phase: 3
title: 'Correct UX truth, regenerate docs, and close out'
status: pending
priority: P1
effort: '1d'
dependencies: [2]
---

# Phase 3: correct UX truth, regenerate docs, and close out

## Goal

Make the idle-after-interrupt state accurate for a provider that can stop mid-tool, keep every current design authority and both shipped shells aligned, publish measured provider capability, and finish only after focused and repository-wide gates pass.

## Copy decision

The existing disclosure—`stopped after the last completed tool call · files already written stay written`—describes a between-tool boundary. Codex stream-abort may terminate an in-flight command and leave partial effects. Replace it everywhere current/authoritative with:

`turn stopped · in-flight work may be partial · written files stay written`

This is not a Codex-only label. It is the provider-neutral minimum truth for Stop: the provider turn ended, in-flight work might be incomplete, and nothing already written was undone.

## Files

### Canonical product and UX authority

| File                                                                                                                           | Change                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `_bmad-output/specs/spec-agent-node-room/SPEC.md`                                                                              | Amend “Interrupt is not undo” so it does not promise session state only through a completed tool; state that in-flight work can be partial. |
| `_bmad-output/specs/spec-agent-node-room/control-states.md`                                                                    | Replace the between-tool-only disclosure/semantics with the provider-neutral contract.                                                      |
| `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`                                | Replace all three normative copy/state/journey occurrences. Preserve voice, placement, and state behavior.                                  |
| `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md`                                    | Replace the stop-disclosure literal; keep its one-line typography and anatomy unchanged.                                                    |
| `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/mockups/key-steering-dock.html`               | Update the current canonical steering-state mockup. Do not edit `.working/` or historical review reports.                                   |
| `claude-design/design_handoff_node_room_transcript_steering/README.md`                                                         | Update the handoff's disclosure specification.                                                                                              |
| `claude-design/design_handoff_node_room_transcript_steering/{Console Node Room,Legacy Node Room,Steering Dock States}.dc.html` | Update the three current handoff prototypes that embed the old literal.                                                                     |

The absorbed `sources/spec-live-agent-steering/` tree and dated accessibility/rubric reports are historical inputs/evidence, not current authority; do not rewrite them. If a generated or current artifact contains the old literal beyond the table above, classify it before editing rather than doing an indiscriminate repository replacement.

### Shipped UI and tests

| File                                                                           | Change                                                                                                                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/steering-dock.ts`                                        | Change only `STEERING_INTERRUPT_DISCLOSURE`.                                                                                                        |
| `packages/web/src/lib/steering-dock.test.ts`                                   | Pin the new exact shared value.                                                                                                                     |
| `packages/web/src/components/workflows/ComposerDock.test.tsx`                  | Update Legacy idle-state copy assertion.                                                                                                            |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`            | Update the Legacy room integration assertion.                                                                                                       |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` | Update Console idle-state copy assertions.                                                                                                          |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`     | Update the Console room integration assertion.                                                                                                      |
| `e2e/ui/agent-interrupt-redirect.spec.ts`                                      | Update the expected literal and retain/extend two-shell state, overflow, reduced-motion, focus, and screenshot evidence for the revised disclosure. |

No component structure or CSS change is expected. If the new copy cannot meet the one-line geometry below, adjust the copy in the canonical UX first; do not silently shrink type, clip text, or diverge the shells.

### Provider evidence and closeout

| File                                                                                   | Change                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`                        | Replace the provisional Codex “pins shape” bullet with the measured terminal shape, normalized marker, strict same-thread behavior, and test/report references. Update the disclosure expectation in the UI section. |
| `_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md`                  | Change Codex evidence to measured, cite the plan-local spike report, describe deferred-id abort/no-cold-retry/strict resume, and remove the inaccurate `startThread` fallback statement for guidance.                |
| `packages/docs-web/src/content/docs/reference/provider-capabilities.md`                | Regenerate; never hand-edit. Codex “Turn interrupt” becomes `stream-abort`.                                                                                                                                          |
| `plans/260920-0216-issue-184-interrupt-and-redirect-codex-agent/reports/acceptance.md` | Map each plan/Story AC to named tests, spike fields, visual evidence, and commands with their actual result.                                                                                                         |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`             | Move Story 2.4 from `backlog` to `done` only after every gate below passes.                                                                                                                                          |

## Visual and interaction acceptance

Verify both Legacy and Console, not just the shared constant:

| State                | Required visual/interaction result                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generating           | `Stop` left and `Queue` right retain their sizes/positions; queued band remains `QUEUED`; no stop disclosure is shown.                                                                                                |
| Interrupting         | `Stopping…` remains focusable with `aria-disabled`, never native `disabled`; focus does not fall to `<body>`; reduced motion removes nonessential animation.                                                          |
| Idle after interrupt | Stop is absent; send reads `Send now`; a non-empty band reads `WILL SEND`; the new disclosure appears once between band and field (or above the field when no band); open tool row reads `⚠ interrupted`, not failed. |
| Generating again     | Disclosure disappears, controls return to generating state without horizontal movement, and the redirected operator row/order remains unchanged.                                                                      |

Viewport criteria:

- Legacy at its 460px authored room width: the disclosure remains one line, legible, and wholly inside the dock; no room-driven horizontal overflow.
- Console at its 520px authored reference panel width: same anatomy and one-line disclosure, with no shell-specific wording or styling.
- Both shells at the existing 460×900 responsive evidence viewport: panel/dock remain inside the viewport and controls do not overlap, clip, or wrap unexpectedly.
- Preserve the existing 1440×900 full-room captures for context. Use the room's measured width in evidence; a browser viewport width is not itself proof of the 520px Console panel.

The existing Playwright fake provider is correct for UI state/geometry because the UI consumes provider-independent sub-state and transcript rows. Real Codex protocol behavior is proven by Phases 1–2, not by putting live credentials into browser tests.

## Steps

1. Update the canonical SPEC/control-state and final UX design/experience copy. Then update the current mockup/handoff artifacts so no current authority contradicts the new semantics.
2. Change the shared web constant and unit/integration assertions in both shells.
3. Update `agent-interrupt-redirect.spec.ts`; run it with proof output and inspect the idle screenshots/measurements at 460px, the Console 520px reference, and full-room context.
4. Update the steering test plan and provider matrix using only the passing spike and tests. Do not claim reliability beyond the measured three cycles.
5. Run `bun run generate:capability-matrix`, inspect the diff, then run the generated-file check.
6. Write the acceptance report with actual commands/results and links to the plan-local spike report. Record the remaining operational risk that Stop is not undo; do not record same-thread fallback or inaccurate disclosure as accepted gaps because this plan fixes them.
7. Run focused web/e2e gates, then `bun run validate`. Fix regressions without weakening tests.
8. Change sprint status to `done` last. Re-run formatting/generated checks after that edit. A later implementation PR must use `.github/pull_request_template.md` and `Closes #184`.

## Verification

```bash
# Provider/workflow checks are repeated here to guard the integrated revision.
cd packages/providers && bun test src/codex/provider.test.ts
cd ../workflows && bun test src/dag-executor.test.ts -t 'Codex interrupt'

# Both web shells and shared derivation.
cd ../web
bun test src/lib/steering-dock.test.ts
NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx

# Standalone Playwright package; its harness owns and cleans up ports/processes.
cd ../../e2e
ARCHON_E2E_PROOF=1 npx playwright test -c playwright.config.ts ui/agent-interrupt-redirect.spec.ts

# Generated docs and repository gate.
cd ..
bun run generate:capability-matrix
bun run check:capability-matrix
bun run validate
```

If the e2e package is not installed, use its documented `npm ci`/browser setup; do not convert an unsupported or skipped run into passing evidence. Root `bun run validate` does not run this standalone Playwright package, so both gates are required.

## Operations, compatibility, and rollback

- The copy change is intentionally global: every provider can leave external or file effects that Stop does not undo, and Codex proves the stronger partial-work case.
- No API-generated types need regeneration because no server schema changes.
- Capability-matrix output is machine-owned. Reverting only generated Markdown while keeping the capability flip will fail `check:capability-matrix`.
- Rollback of Codex interrupt sets the capability to `false` and removes provider wiring as described in Phase 2. Retain the truthful disclosure and canonical UX correction; it is safer and accurate for all interrupt mechanisms.
