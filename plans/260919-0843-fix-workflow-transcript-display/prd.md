# PRD: Fix workflow transcript display and Legacy run viewport

Slug: `fix-workflow-transcript-display` · Issue: https://github.com/kevinle128/Archon/issues/208 · Branch base: `develop`

## Overview

Four connected defects in workflow run rooms (issue 208):

1. Devin and DeepSeek ACP text notifications are persisted as **complete** messages, so one streamed answer renders as many assistant rows.
2. A node whose `output_format` is one top-level string renders the serialized JSON envelope instead of the string's Markdown content.
3. A long Legacy transcript can enlarge and scroll the document, exposing a blank region outside the fixed run shell.
4. The Legacy runtime graph shows a minimap the run-room design does not require.

Repaired experience: new ACP fragments group into one answer per execution attempt; the narrow one-string structured result renders readably in every Web transcript mount; the Legacy run shell stays fixed to the viewport; only the Legacy runtime minimap is removed. Audit rows, API text, structured node output, downstream references, builders, and unrelated providers stay unchanged.

## Goals and success metrics

- Every new Devin/DeepSeek ACP `agent_message_chunk` text persists with `metadata.text_mode: 'delta'`; one streamed answer = one assistant block within one occurrence and attempt.
- Direct, loop-invalid, and loop-missing structured-output re-asks each keep responses in distinct transcript attempts.
- An exact one-string JSON envelope renders as its string value in Legacy, Console selected room, and Console inline history; ineligible schemas and malformed/duplicate-key/noncanonical/extra-key/non-string payloads render byte-for-byte unchanged.
- Stored/API assistant text, item metadata, structured node output, and downstream `$producer.output.report` consumers are unchanged.
- Legacy root height stays within 2px of the viewport and root scroll position stays 0 through inner-boundary and pointer-exit wheel input at `1440x1000` and `390x844`; transcript tail, applicable controls, keyboard traversal, visible focus, keyboard scrolling, and focus restoration remain usable.
- Legacy runtime graph has no minimap; controls, pan, zoom, fit, layout, focus, and node selection pass; both builder minimaps remain.
- Canonical node-room spec and governed functional/visual verification contracts describe and prove the delivered states.
- Focused suites, package-isolated tests, build/type/lint/format checks, browser proofs, and `bun run validate` pass without weakened assertions.

## Non-goals (do NOT build)

- No schema/stored-data migration; historical untagged ACP rows remain as recorded (no heuristic rewriting).
- No inferred `text_mode` on old rows, no provider-side buffering, no fabricated stream IDs, no shared ACP mapper abstraction.
- No new YAML surface, API transform, generated-type change, or `metadata`/DB field.
- No changes to the E2E fake provider's `structuredOutput` capability (`'enforced' | 'best-effort' | false`, not boolean).
- No workflow-builder minimap removal (`WorkflowCanvas.tsx`, `BuilderCanvas.tsx` untouched); no `RunGraphPanel.tsx` change (Console runtime graph already minimap-free, used as parity regression).
- No generic renderer, JSON-specific React component, raw HTML, evaluation, JSON repair, or custom sanitizer.
- No JavaScript wheel handlers / document-level listeners for scroll containment — native CSS only.
- No new dependencies; no definition-snapshot infrastructure; no multi-field structured rendering changes; no non-Web batch formatting changes.
- Do not edit historical plan records; do not attribute new visual captures to the existing HITL run.

## Technical context

### Provider / executor boundary (US-001)

- `packages/providers/src/community/devin/event-bridge.ts` — `mapDevinSessionUpdate()` maps ACP `session/update` notifications to `MessageChunk`s; add `textMode: 'delta'` to the text-valued `agent_message_chunk` mapping only (thought chunks, replay suppression, tool events, usage, chunk order unchanged).
- `packages/providers/src/community/deepseek/event-bridge.ts` — `mapDeepseekSessionUpdate()`, same one-field change.
- `packages/workflows/src/dag-executor.ts` — loop invalid-output re-ask already rotates at ~line 6630 (`iterationExecutionScope = newTranscriptAttempt(iterationExecutionScope)`); the loop missing-output branch at ~line 6660 increments `reaskAttempt` without rotation — add the same `newTranscriptAttempt()` call there before the next provider pass. Direct re-asks already rotate (line ~2287, ~3029). No other production change in this phase.
- `packages/web/src/lib/project-text-transcript.ts` — `projectTextTranscript()` already joins compatible delta rows and stops at non-text/execution boundaries; regression-only in this phase.
- `packages/providers/src/types.ts` — `MessageChunk` needs no signature change; `textMode` field already exists.

### Structured presentation (US-002, US-003)

- `packages/web/src/lib/agent-history.ts` — `buildAgentHistory()` is the shared render-neutral seam; add optional `outputFormat?: Record<string, unknown>` to `AgentHistoryInput` and a small local helper that runs **after** `projectTextTranscript()`, per projected text item.
- Unwrap guard (ALL required): schema is a non-array record with `type === 'object'` and `properties` is a non-array record with exactly one own key; that property is a non-array record with `type === 'string'` (annotations/constraints OK); entire text parses to a non-null non-array object with exactly that key and a string value; `rawText === JSON.stringify(parsed)`. Any failed guard or parse error → return original bytes. Never mutate inputs or alter IDs/sequence/execution identity/occurrence/attempt/timestamps/tool items/status.
- Three production mounts to wire with the matched definition node's `output_format` (including nested loop-group definitions via each shell's existing resolver — do not build a second recursive walker):
  - `packages/web/src/components/workflows/LegacyNodeRoom.tsx` → `NodeTranscriptPane.tsx`
  - `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
  - `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` → `inspect/ConsoleExecutionHistory.tsx`
- Missing/loading/deleted definition → render original history, rerender when resolved. Check Console **inline** history before room selection (selection suspends it).
- `packages/workflows/src/dag-executor.ts` — regression proof only: structured result stays `{ report: string }` object and downstream `$producer.output.report` receives the string.
- E2E: create `e2e/fixtures/workflows/e2e-transcript-display.yaml` (deterministic bash anchor + conditionally-skipped exact/fallback report nodes declaring the one-string schema; no AI call) and `e2e/ui/workflow-transcript-display.spec.ts`; extend `e2e/lib/playwright/archon-runtime.ts` with ONE narrow `prepareTranscriptDisplayRun()`-style helper seeding exact fragments, fallback rows (malformed, extra-key, multi-field, schema-less, duplicate-key, noncanonical-escape), execution metadata, and lifecycle events into the isolated SQLite DB (established occurrence-navigation pattern). No generic DB-seeding API.
- `_bmad-output/specs/spec-agent-node-room/SPEC.md` — canonical node-room contract; must be updated BEFORE the code change to state the resolved rule: tool payloads keep their explicit Raw affordance, exact one-string envelopes show their string value, assistant text that cannot be losslessly classified fails closed to original text. If maintainers reject the spec change, US-002/US-003 are blocked — do not invent a different fallback. (`DESIGN.md`/`EXPERIENCE.md` under `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/` are adopted companions; `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/` supplies graph/layout reference.)

### Legacy viewport + minimap (US-004)

Prior-session reproduction measured viewport 873px, root scroll height ~18,000px, `window.scrollY` 668px (`research/live-legacy-scroll-reproduction.md`). Causes: `span.sr-only` labels absolutely positioned as direct children of **static** tool summaries; Legacy right room panel lacks `min-h-0`/overflow containment; transcript scroller lacks overscroll boundary. MUST recapture as failing browser assertions before CSS edits.

Repair order (local fixes mandatory; shared-layout escalation conditional):
1. `packages/web/src/components/workflows/NodeRoom.tsx` — add `relative` to the direct tool-row summary (keep `sr-only` text present, not visually exposed).
2. `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` — same fix on the duplicated Console row.
3. `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` — `min-h-0 overflow-hidden` on the right resizable run panel.
4. `packages/web/src/components/workflows/NodeTranscriptPane.tsx` — `overscroll-y-contain` on `[data-testid='node-transcript-scroll']` (remains the sole vertical scroll owner).
5. `packages/web/src/components/workflows/WorkflowDagViewer.tsx` — remove `MiniMap` plus imports/constants dead only because of it (`ExecutionNodeData`, status-color data); keep controls/pan/zoom/fit/layout/focus/selection.
6. `packages/web/src/components/layout/Layout.tsx` — conditional only: `Layout.main` already has `overflow-hidden`; add smallest missing `min-h-0`/containment rule ONLY if post-fix browser metrics still prove an ancestor defect, and then run a route sweep (Legacy Chat, Dashboard, Workflows, Builder, Settings) proving each route's intended scroll owner.

Browser proof: `e2e/ui/workflow-run-hitl-room.spec.ts` gains desktop (`1440x1000`) and narrow (`390x844`) long-history cases — geometry, transcript-boundary + pointer-exit wheel (over transcript, room header, non-node graph area), hidden-label bounding boxes, tail reachability, Tab/Shift+Tab order, visible focus, keyboard transcript scrolling, Ask/composer reachability, focus restoration. Split long cases into the established extended-timeout class (`T.xlong`); poll deterministic row load/geometry, no sleeps. `e2e/ui/workflow-transcript-display.spec.ts` gains runtime-graph absence + retained-interaction assertions using the US-003 fixture; builder minimap presence asserted.

### Verification governance (US-005)

- `.agents/skills/verify-archon/lib/browser-scenarios.ts` — map new `ui.transcript-display` scenario to exactly: `[V:transcript-display.structured]`, `[V:transcript-display.legacy-scroll-desktop]`, `[V:transcript-display.legacy-scroll-narrow]`, `[V:transcript-display.graph]`.
- `.agents/skills/verify-archon/features/run-ui.json` — register matching behavior/proof obligations; keep `ui.visual` → `[V:verify.visual-captures]` but regenerate its `visual-<digest>` runner ID after `visual-config.json` changes (stale binding must fail selection).
- `.agents/skills/verify-archon/visual-config.json` — add `assistant-report` and `runtime-graph` states for both surfaces at desktop + narrow viewports; refresh the canonical spec hash after the US-002 SPEC.md update.
- `.agents/skills/verify-archon/lib/visual-review.ts` + `e2e/ui/verifier-visual.spec.ts` — extend manifest/reviewer schema so each case records the actual run ID used (HITL captures and prepared transcript-display captures come from different real runs); drive and capture the new configured states.
- Run a fresh governed functional + visual verification attempt against a clean committed target; ordinary Playwright output is not governed visual proof.

### Environment prerequisites

- Run `bun install` from the lockfile first: DOM component tests require `happy-dom`, which is declared but absent in this checkout.
- Do not start duplicate dev servers; reuse the verifier/runtime harness, record owned PIDs/ports, stop what you start.

## Story overview

| ID | Title | Phase | Depends on |
| --- | --- | --- | --- |
| US-001 | Provider delta boundaries + loop missing-output attempt rotation | 1 | — |
| US-002 | Canonical spec reconciliation + one-string unwrap transform in `buildAgentHistory()` | 2 (core) | US-001 |
| US-003 | Wire `outputFormat` through three transcript mounts + deterministic real-server E2E | 2 (wiring/E2E) | US-002 |
| US-004 | Legacy viewport containment, hidden-label geometry, runtime minimap removal + browser proof | 3 (fix) | US-003 |
| US-005 | Governed verification registration + fresh functional/visual attempt + full validate | 3 (governance) | US-004 |

## Working agreements

- TDD per the plan: add/adjust failing tests first, record RED evidence (bridge expectations, executor assertions, browser geometry), then implement, then run the focused suites listed in each story's technical notes.
- KISS/YAGNI: one explicit field per bridge mapping; one small local helper in `agent-history.ts`; three CSS classes; one minimap deletion. No abstractions beyond what the plan names.
- Fail closed everywhere: unknown schema/payload → original bytes; missing definition → original text; unmeasured shared-layout change → don't make it.
- Each story is independently revertible with its tests.
