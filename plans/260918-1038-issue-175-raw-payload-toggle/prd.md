# PRD — Issue #175 / Story 1.2: Raw payload toggle

Plan source: `plans/260918-1038-issue-175-raw-payload-toggle/plan.md` + `phase-01-start.md`, `phase-02-two-surface-renderers.md`, `phase-03-end-to-end-and-visual-verification.md`.
Issue: https://github.com/kevinle128/Archon/issues/175

## Overview

Story 1.1 (merged in `#197`, commit `0fb1fd04`) shipped a tool-row shell on both
node-room surfaces with **temporary** nested `Input` and `Output` `<details>`
disclosures. Story 1.2 replaces those two disclosures with a single compact,
closed-by-default **`Raw`** disclosure in every expanded tool row, on **both**
the Legacy node room and the Console node room. Opening `Raw` shows a
pretty-printed canonical payload with exactly the provider-facing `name`,
`input`, and `output` fields.

This is a **presentation-only** story. It must not change persisted messages,
API schemas, tool-name normalization, workflow execution, or provider behavior.

## Problem

- The nested `Input`/`Output` disclosures are a temporary bridge: two
  disclosures per row, inconsistent with the UX contract, and they expose
  payload markup in the DOM even when collapsed.
- Users need on-demand access to the canonical paired payload
  `{ name, input, output }` — the original provider-facing name plus parsed
  values — without ids, labels, icons, facts, or other UI metadata.
- The tool call and tool result are **separate persisted rows**
  (`remote_agent_messages`), so `Raw` is deliberately a canonical paired
  projection, not a byte-for-byte rendering of one stored row.

## Solution

Three layers, implemented as three stories:

1. **Shared contract** — a total, React-free `ToolRawPayload` type +
   `toolRawPayloadJson` serializer in `packages/web/src/lib/tool-presentation.ts`.
   Provider interpretation stays in the shared core; shells only render
   `presentation.rawPayload`.
2. **Two renderers** — identical Raw toggle behavior in
   `packages/web/src/components/workflows/NodeRoom.tsx` (Legacy) and
   `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`
   (Console). Conditional rendering: no `<pre>`/serialized text exists in the
   DOM while closed. Then remove the orphaned `formatToolIo` helper.
3. **E2E + visual verification** — update the three HITL/visual specs to the
   final contract, capture synthetic evidence, write the visual-acceptance
   report, and pass the full validation gate before PR delivery.

## Goals and success metrics

- Every expanded tool row on both surfaces has exactly one `Raw` button in the
  body bar; collapsed summaries contain no Raw control.
- Raw starts closed on every newly mounted history item; while closed, no Raw
  `<pre>` or serialized payload text exists in the DOM.
- Open Raw shows valid 2-space-indented JSON whose only normal top-level keys
  are `name`, `input`, `output` (in that order when present); `name` is the
  untouched provider name, not the normalized display label.
- Toggling Raw never toggles the outer row; a pending call paired with its
  result keeps the same row and Raw state and updates the payload; a different
  history-item id mounts closed.
- `View full output` loading/success/error/retry works identically whether Raw
  is closed or open; a successful fetch re-presents facts and `rawPayload` with
  the full output.
- Keyboard flow, `aria-expanded`/`aria-controls` correctness, instance-safe
  `useId()` panel ids (two sibling Console lists must not collide), WCAG AA
  contrast, and no page-level horizontal overflow at 1440/1024/768/460/390px and
  200% zoom.
- Temporary nested `Input`/`Output` disclosures and `formatToolIo` are gone.
- `bun run validate` and the PR E2E Verify selected HITL scenarios pass; PR
  targets `develop` with `Closes #175`.

## Non-goals

- No API, database, OpenAPI, provider, workflow-engine, or persistence changes.
- No redaction/masking rules (the same payload is already user-visible today).
- No virtualization, async JSON formatting, new JSON viewer, syntax
  highlighting, copy/download controls, or feature flags.
- No changes to the outer `<details>` shell, non-tool rows, tool presentation
  rules, truncation limits, or the detail endpoint.
- No `dangerouslySetInnerHTML`; Raw renders as a React text node only.
- No axe dependency or invented "serious violations" harness — keyboard +
  targeted Chromium accessibility-tree assertions are the required proof.
- No new expensive E2E failure fixtures (component suites already cover
  rejected/malformed detail responses).
- No branch-policy or unrelated CI cleanup. The PR targets the live `develop`
  integration branch (remote default + `pr-e2e-verify.yml`), even though
  `AGENTS.md` still says `dev` — do not expand scope.

## Technical context

### Data path (verified)

`remote_agent_messages` tool-call/tool-result rows → list endpoint (string
output may be truncated; `full_output_available` flag) → `projectToolTranscript`
inside `buildAgentHistory` → `toolRowPresentation` →
`NodeRoom`/`LegacyNodeRoom` or `ConsoleAgentHistoryList` → optional detail
endpoint (`getWorkflowNodeMessage`) for full output.

### Key files and anchors

- `packages/web/src/lib/tool-presentation.ts` — shared React-free core.
  `ToolRowPresentation` interface at `:79`; `toolRowPresentation(input, facts)`
  at `:538`. Add `ToolRawPayload`, the `rawPayload` field (on
  `ToolRowPresentation`, not the lower-level `ToolPresentation`), and
  `toolRawPayloadJson(payload)` here.
- `packages/web/src/lib/pair-tool-transcript.ts:75` — `formatToolIo`, only used
  by the temporary disclosures; remove after both renderers migrate.
  `projectToolTranscript` at `:80` does call/result pairing.
- `packages/web/src/lib/agent-history.ts` — `buildAgentHistory` at `:247`;
  tool-item `presentation: toolRowPresentation(...)` at `:186`;
  `canLoadFullOutput` at `:183`; `full_output_available` check at `:82`.
- `packages/web/src/components/workflows/NodeRoom.tsx` — Legacy `ToolHistory`
  component at `:314`. `open`/`touched` state `:325-326`; full-output state
  `:327-330`; re-presentation on full output `:334-344`; `loadFull` `:351`;
  propagation guard `onToggle` `:367-375`; facts bar `:432-434`; nested `Input`
  `<details>` `:435-442`; `Output` `:443-450`; `View full output` `:451-460`;
  load error/retry `:461-472`. `formatToolIo` import at `:13`.
- `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`
  — Console `ToolHistory` at `:238` (same state layout `:245-250`,
  re-presentation `:254-264`, `loadFull` `:271`, guard `onToggle` `:286-294`,
  facts `:341-343`, `Input` details `:344-351`, `Output` `:352-359`,
  `View full output` `:360-369`, error/retry `:370-381`). `formatToolIo` import
  at `:12`. Console keeps local `!` overrides where parent prose styles win
  (e.g. `focus-visible:outline-accent-bright!`).
- `packages/workflows/src/schemas/node-message.ts:61` —
  `NodeMessageToolPayload` (`name`, `id`, optional `input`/`output`).
- Tests: `tool-presentation.test.ts`, `agent-history.test.ts`,
  `pair-tool-transcript.test.ts` (`formatToolIo` suite at `:95`),
  `components/workflows/NodeRoom.test.tsx` (server-render suite),
  `components/workflows/LegacyNodeRoom.test.tsx` (happy-dom),
  `experiments/console/components/ConsoleNodeRoom.test.tsx` (happy-dom),
  `experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx`.
- E2E: `e2e/ui/workflow-run-hitl.spec.ts`,
  `e2e/ui/workflow-run-hitl-room.spec.ts`, `e2e/ui/agent-tool-row-visual.spec.ts`
  (7 old Input/Output assertion sites across the three — find via the `rg`
  command in phase-03).
- Evidence output: `plans/260918-1038-issue-175-raw-payload-toggle/reports/visual-acceptance.md`
  - `reports/evidence/` (synthetic payloads only — never real credentials or
    customer data).

### Contract details that must survive implementation

- `toolRowPresentation` stays **total**: adversarial getters/malformed in-memory
  values cannot throw through it; capture failure yields
  `{ name: 'generic', input: undefined, output: undefined }`.
- `toolRawPayloadJson` builds `{ name, input, output }` in that key order via
  `JSON.stringify(v, null, 2)`; `undefined` props omitted, `null` kept. On
  cycles/`bigint`/serialization exceptions it returns valid pretty-printed
  `{ name, error: 'payload is not serializable' }` — never throws, never leaks
  stacks/inspection output, preserves a safely-readable string name else
  `generic`, and the fallback itself cannot throw. No replacer that silently
  changes values.
- Raw button: native `<button>`, visible text `Raw`, ` ▾` suffix in an
  `aria-hidden` span only while open; `aria-expanded` always accurate;
  `aria-controls` present only while the conditional panel exists.
  `min-height: 24px`, rendered target ≥ 24×24px. Explicit closed/hover/
  focus-visible/open classes — do **not** rely on an unverified Tailwind
  `aria-expanded:` variant. Open/focus = bright border + primary text.
- Raw `<pre id={rawPanelId}>` renders only when open, after the body bar:
  design-system inset surface/border/radius, `px-2.5 py-2`, `text-text-primary`
  (DESIGN.md structured binding overrides the mockup's `text-tertiary`),
  monospace ~`11.5px/1.5`, wrapping guards
  `min-w-0 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]`.
- `useId()`-derived panel ids; tests resolve them with
  `document.getElementById` (React `useId` output is not assumed
  CSS-selector-safe). Two sibling `ConsoleAgentHistoryList` mounts must produce
  distinct ids.
- The existing nested-toggle propagation guard (`event.target !==
event.currentTarget` in `onToggle`) stays — later subtasks add more
  interactive body controls; clarify the invariant in its comment.
- Serialization happens only while Raw is open. No memoization/workers without
  measured evidence; record visibly slow fixtures as follow-ups.

### Validation commands

Per-phase targeted tests, then from repo root before PR:

```bash
bun run type-check
bun run lint
bun --filter @archon/web test
bun run --cwd e2e typecheck
bun run --cwd e2e test:ui:hitl
bun run validate   # mandatory before opening the PR
```

Component suites run with `NODE_ENV=development bun test <file>`.

### Delivery

PR targets `develop`, uses `.github/pull_request_template.md`, includes
`Closes #175`, passes PR E2E Verify's mapped Legacy tool-output, Console
tool-output, and history-complete scenarios
(`.agents/skills/verify-archon/features/hitl-run-room.json`). After all gates
pass, `ak-feature` moves sprint-status key
`1-2-inspect-the-raw-payload-of-a-tool-call` in
`_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` to
`done` before the issue closes.

## Story overview

| ID     | Title                                                                      | Maps to  | Depends on |
| ------ | -------------------------------------------------------------------------- | -------- | ---------- |
| US-001 | Shared Raw payload contract + unit tests                                   | Phase 01 | —          |
| US-002 | Raw toggle on Legacy + Console tool rows; remove `formatToolIo`            | Phase 02 | US-001     |
| US-003 | E2E spec migration, visual/accessibility/responsive verification, delivery | Phase 03 | US-002     |
