---
title: 'Issue 175 raw payload toggle'
description: 'Verified implementation plan for Story 1.2 on Legacy and Console.'
status: pending
priority: P1
effort: '3 phases'
tags: [issue-175, agent-node-room, web, tdd, epic-1]
created: 2026-09-18
issue: 'https://github.com/kevinle128/Archon/issues/175'
---

# Story 1.2 / Issue #175 — Raw payload toggle

## Status

Ready for implementation. Story 1.1 is merged (`#197`, commit `0fb1fd04`), so the prerequisite tool-row shell exists on both node-room surfaces. Issue #175 is open and the review found no competing open PR. No unresolved product or design decision remains.

## Goal and user outcome

Replace Story 1.1's temporary nested `Input` and `Output` disclosures with one compact `Raw` disclosure in every expanded tool row, in both the Legacy and Console node rooms. The default row remains a concise presentation. On demand, `Raw` shows a pretty-printed canonical payload with exactly the provider-facing `name`, `input`, and `output` fields. Existing full-output loading, error handling, retry, responsive layout, and accessibility must continue to work.

This is a presentation-only story. It must not change persisted messages, API schemas, tool-name normalization, workflow execution, or provider behavior.

## Evidence and authority

The implementation must follow these sources in this order:

1. Issue `#175` and Epic 1 Story 1.2 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` define the acceptance criteria.
2. `_bmad-output/specs/spec-agent-node-room/SPEC.md` (CAP-7/NFR) and `test-plan.md` define the machine and renderer-test contracts.
3. `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`, especially AD-1, AD-3, AD-10, and the CAP-7 mapping, requires a total React-free core, payload carried on the item, and shells that own markup/interaction without interpreting provider fields.
4. `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` defines the body bar, swap behavior, payload shape, keyboard flow, and canonical `460px` narrow width.
5. The adjacent `DESIGN.md` defines `raw-toggle` and `body-box`. Its structured binding and component definition specify `text-primary` for Raw JSON and override both its own generic “body text” prose and the mockup's inconsistent inline `text-tertiary` annotation.
6. The adjacent `mockups/key-transcript-states.html`, section F, is the visual reference where it does not conflict with the preceding sources.
7. `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md` requires the untouched provider tool name to remain available for Raw.

Repository inspection also confirmed the real data and UI path:

`remote_agent_messages` tool-call/tool-result rows → list endpoint (possibly truncated string output) → `projectToolTranscript` inside `buildAgentHistory` → `toolRowPresentation` → `LegacyNodeRoom`/`NodeRoom` or `ConsoleAgentHistoryList` → optional detail endpoint for full output.

The call and result are separate persisted rows. Therefore Raw is **not** a byte-for-byte rendering of one stored row. It is the canonical paired projection required by the UX contract: `{ name, input, output }`, using parsed values and the original provider-facing name. The tool-use id, message id, row id, presentation label, icon, facts, and other UI metadata are intentionally excluded.

## Verified current behavior

- `NodeMessageToolPayload` contains `name`, `id`, and optional `input`/`output`.
- Pairing preserves the call name and input, joins the result output, and keeps a stable card id while a result arrives.
- Paged history truncates long string output and sets `full_output_available`; the detail endpoint returns the complete row.
- Both renderers have equivalent outer-row state, nested temporary `Input`/`Output` disclosures, and full-output load/error/retry state, but their markup is separate under `components/workflows/` and `experiments/console/`.
- `ConsoleAgentHistoryList` is also used by `ConsoleExecutionHistory`; more than one list can exist in one document, so generated DOM ids must be instance-safe.
- `formatToolIo` is only used by the temporary disclosures and can be removed after both renderers migrate.
- PRs targeting the repository's active `develop` branch run `.github/workflows/pr-e2e-verify.yml`; `.agents/skills/verify-archon/features/hitl-run-room.json` maps the affected Legacy/Console tool-output scenarios. The general `test.yml` branch filters are not the relevant PR gate for this work. `AGENTS.md` still says `dev`, but the remote default branch and executable PR workflow both say `develop`; use the live repository integration target and do not expand this story into branch-policy cleanup.

## Scope

### In scope

- A React-free Raw payload contract and serializer in the shared presentation core.
- One closed-by-default `Raw` control per expanded tool row on Legacy and Console surfaces.
- Conditional Raw JSON rendering: no serialized payload node or string exists in the DOM while closed.
- Preservation of the existing full-output load, loading, failure, and retry flow whether Raw is closed or open.
- Removal of the temporary nested `Input` and `Output` `<details>` elements and the now-unused formatter.
- Unit, component, E2E, accessibility, responsive, and visual coverage for the changed states.
- Story/issue completion through the issue-mandated `ak-feature` workflow after implementation and validation are complete, including its sprint tracker transition.

### Out of scope

- API, database, OpenAPI, provider, workflow-engine, or persistence changes.
- Redaction or masking rules. The same payload is already user-visible through the existing disclosures; this story changes presentation and makes closed state less exposed in the DOM.
- Virtualization, async JSON formatting, a new JSON viewer, syntax highlighting, copy/download controls, or a feature flag.
- Changes to the outer `<details>` shell, non-tool rows, tool presentation rules, truncation limits, or detail endpoint behavior.
- General cleanup of branch names or unrelated CI workflows.

## Technical design

### Shared payload contract

In `packages/web/src/lib/tool-presentation.ts`:

- Add `ToolRawPayload` with exactly `name`, `input`, and `output`.
- Add an opaque `rawPayload: ToolRawPayload` field to `ToolRowPresentation` (not the lower-level generic presentation result). `toolRowPresentation` creates it from its existing input, preserving the original `name` and parsed values.
- Keep the public helper total. If adversarial getters or malformed in-memory values make capture impossible, return `{ name: 'generic', input: undefined, output: undefined }` rather than throwing; normal API data has already passed schema validation.
- Add `toolRawPayloadJson(payload)` which serializes in fixed key order with `JSON.stringify(..., null, 2)`. Normal JSON behavior is intentional: absent `undefined` properties are omitted, `null` is retained, and strings are escaped as JSON.
- If an in-memory payload is cyclic or contains a non-JSON value such as `bigint`, return a small valid, pretty-printed `{ name, error }` diagnostic rather than throwing during render; preserve a safely readable string name and otherwise use `generic`. This defensive shape is the documented exception to the normal three-key contract and is unreachable for schema-validated JSON rows. Do not use a replacer that silently changes values.

This keeps provider interpretation in the shared core. Both shells only render `presentation.rawPayload`; after a successful full-output fetch, their existing `toolRowPresentation(...)` re-presentation path produces a replacement `rawPayload` containing the full output.

### Renderer behavior

Make equivalent changes in:

- `packages/web/src/components/workflows/NodeRoom.tsx` (the Legacy transcript shell)
- `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`

For each mounted tool row:

1. Add local `rawOpen`, initially `false`, and a `useId()`-derived panel id. State belongs to the row component and therefore resets when React receives a new history-item key/id; it remains stable when polling updates the same paired card.
2. Remove nested `Input` and `Output` disclosure markup.
3. Render a single body bar when the outer row is expanded: facts remain on the left; the `Raw` button is the final item on the right.
4. Give the closed button visible text `Raw`; only the open state appends the design's ` ▾` suffix, in an `aria-hidden` span. Use `aria-expanded`. Set `aria-controls` only while the conditional panel exists.
5. Use the specified `min-height: 24px` and horizontal padding; verify the rendered target clears `24 × 24px`. Retain the Console surface's local `!` overrides where parent prose styles otherwise win.
6. Use explicit closed, hover, focus-visible, and open classes. Do not depend on an unverified Tailwind `aria-expanded:` variant. Open/focus styling uses the documented bright border and primary text.
7. Only when `rawOpen` is true, call `toolRawPayloadJson(presentation.rawPayload)` and render it in a `<pre id={rawPanelId}>` after the body bar. Use the design-system inset surface/border/radius/padding, `text-text-primary`, monospace type, approximately `11.5px / 1.5`, and wrapping guards (`min-w-0 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]`) so long unbroken values do not cause page-level horizontal overflow.
8. Keep `View full output`, its disabled loading state, load error, and retry after the swapped body slot so it remains available in either Raw state. A successful fetch must be a tool message with defined output; otherwise show `Full output is not available for this call` and do not replace the current presentation.
9. Preserve the existing nested-toggle propagation guard because later subtasks will add other interactive body controls; update its comment if needed so the invariant is explicit.

No live region is required: Raw is a user-operated disclosure, and the loading/error controls already expose their visible state.

### Privacy, performance, and reliability

- Render Raw only as a React text node; do not use `dangerouslySetInnerHTML`.
- Do not log payloads or include real credentials/secrets in screenshots or evidence. Use synthetic fixtures.
- Serialization occurs only while Raw is open. Full outputs can be large, but adding memoization, workers, or virtualization is not justified without measured evidence; record any visibly slow fixture during validation as a follow-up rather than broadening this story.
- Full-output failure preserves the truncated/original presentation and the existing retry path.
- No schema migration, backfill, rollout ordering, or compatibility shim is needed. Rollback is a normal revert of the web-only change.

## Acceptance criteria

### Functional and contract

- Every tool row on both Legacy and Console surfaces has exactly one `Raw` button in the expanded body bar; the collapsed summary itself contains no Raw control.
- Raw is closed for every newly mounted history item. While closed, no serialized Raw payload text or Raw `<pre>` exists in the DOM.
- Opening Raw replaces the empty/default body slot with valid, two-space-indented JSON whose only normal top-level keys are `name`, `input`, and `output`, in that order when present. The documented `{ name, error }` fallback is allowed only for a malformed non-JSON in-memory value that validated API rows cannot contain.
- `name` is the untouched provider name, not the normalized display label. The JSON contains parsed input/output values and does not include ids or UI metadata.
- Closing Raw removes the payload node from the DOM. Toggling Raw does not toggle the outer row.
- Polling a pending call into a paired result keeps the same row and Raw state, and the open payload updates to include the result. A different history-item id mounts closed.
- The temporary nested `Input` and `Output` disclosures and `formatToolIo` are gone.

### Full output and failures

- For a truncated string result, `View full output` is visible with Raw closed and open.
- Loading state disables the action and retains the existing `View full output` label.
- Success re-renders the presentation and Raw payload with the complete output; the truncated tail is absent before Raw opens and present after it opens.
- Network, non-OK, wrong-message-kind, or missing-output responses show an inline error, preserve the current payload, and allow retry.

### Accessibility and visual behavior

- The control has accessible name `Raw`, `aria-expanded` accurately tracks state, and open `aria-controls` references the unique existing panel. Two sibling Console history lists produce distinct ids; tests resolve React `useId()` output with `document.getElementById`, not a CSS selector.
- Keyboard-only users can open a tool row, reach Raw next in the expected flow, toggle it with Enter/Space, and continue to `View full output` when present. Focus remains visible.
- Automated Chromium accessibility-tree checks expose the expected button name, expanded state, and control relationship on both surfaces. The repository has no axe dependency or general “serious violations” harness, so this story does not invent that claim or add a dependency. A manual VoiceOver/NVDA spot-check is useful when that environment is available but is not a release blocker invented by this story.
- Raw JSON uses the design-system primary text on inset surface and meets WCAG AA contrast. Closed, hover/focus, open, and long-payload states match the source artifacts; loading and error retain the existing disabled-button and inline-error patterns.
- At `1440`, `1024`, `768`, `460`, and `390px`, plus `200%` zoom, facts stay left, Raw stays right without an extra breakpoint, JSON wraps, controls remain usable, and the page has no horizontal overflow.

## Files expected to change

Production:

- `packages/web/src/lib/tool-presentation.ts`
- `packages/web/src/components/workflows/NodeRoom.tsx`
- `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`

Tests/evidence:

- `packages/web/src/lib/tool-presentation.test.ts`
- `packages/web/src/lib/agent-history.test.ts`
- `packages/web/src/lib/pair-tool-transcript.test.ts`
- `packages/web/src/components/workflows/NodeRoom.test.tsx`
- `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`
- `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`
- `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx`
- `e2e/ui/workflow-run-hitl.spec.ts`
- `e2e/ui/workflow-run-hitl-room.spec.ts`
- `e2e/ui/agent-tool-row-visual.spec.ts`
- `plans/260918-1038-issue-175-raw-payload-toggle/reports/visual-acceptance.md` and synthetic evidence created in Phase 03

The exact set may shrink if an assertion is already covered, but production changes outside this list require re-checking the architectural boundary and story scope.

## Implementation sequence

1. [Phase 01 — Shared Raw contract](./phase-01-start.md)
2. [Phase 02 — Both renderer surfaces](./phase-02-two-surface-renderers.md)
3. [Phase 03 — End-to-end and visual verification](./phase-03-end-to-end-and-visual-verification.md)

Keep each phase green before proceeding. Do not leave deliberately failing E2E assertions between phases.

## Coordination with Story 1.6 (issue #179)

<!-- Added 2026-09-18 by plans/260918-0825-issue-179-subagent-dispatch-subtasks (red-team findings F2/F3) -->

Story 1.6 (`plans/260918-0825-issue-179-subagent-dispatch-subtasks/`) renders `task`-family rows as a `TaskBody` (context markdown + one nested `<details data-subtask-index>` card per subtask) in the **same** body region this story rewrites. Both plans are pending; either may land first.

- **If 1.6 has already merged when this story is implemented:** keep the `TaskBody`/`SubtaskCard` local functions on both surfaces and move the one conditional (`presentation.body?.kind === 'task' ? <TaskBody …/> : null`) into the Raw swap slot as `rawOpen ? <raw box> : <TaskBody …/>`. Do not delete them with the Input/Output bridge.
- **Either order:** the assertions written as "no `<details>` inside a tool row" / `querySelectorAll('details').length === 0` (Phase 2 steps 3, 11, 12 and the Phase 2 success criterion) mean "no Input/Output disclosures". Scope them to exclude `[data-subtask-index]` cards, or keep them on non-task fixtures only, so 1.6's cards are not a regression by definition.
- The bubbled-toggle guard stays for exactly this reason (Red Team finding 6 above).

## Validation and delivery

Run targeted checks during each phase, then from the repository root:

```bash
bun run type-check
bun run lint
bun --filter @archon/web test
bun run --cwd e2e typecheck
bun run --cwd e2e test:ui:hitl
bun run validate
```

`bun run validate` is mandatory before opening the PR. Recheck issue ownership/open PRs immediately before implementation because `status:processing` is coordination state. The PR must target the repository's active `develop` integration branch, use `.github/pull_request_template.md`, include `Closes #175`, and pass PR E2E Verify's selected HITL scenarios. Save only synthetic-payload visual evidence. Once every acceptance gate passes, let `ak-feature` move `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` entry `1-2-inspect-the-raw-payload-of-a-tool-call` to `done` before the issue closes; do not perform unrelated planning-state edits.

Review this plan again against product outcome, architecture, contracts, security/data integrity, performance, completeness, tests, operations/rollback, and maintainability before implementation handoff. There are no known blockers; the principal residual risk is synchronous formatting of an unusually large full output, which is bounded by explicit user action and does not justify a speculative subsystem.
