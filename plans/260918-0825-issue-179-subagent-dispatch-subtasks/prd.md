# PRD — Issue 179 / Story 1.6: Inspect a subagent dispatch and its subtasks

Source plan: `plans/260918-0825-issue-179-subagent-dispatch-subtasks/` (`plan.md` + `phase-01-start.md` + `phase-02-two-surface-renderers.md` + `phase-03-verification-and-closeout.md` + `reports/scout-report.md`). Issue: https://github.com/kevinle128/Archon/issues/179. Branch: `archon/thread-fca144b4`.

## Overview

When an operator expands a task-family tool row in the agent node room, Archon must show what was delegated and to whom. Two stored provider shapes are normalized into one render-neutral model, then rendered identically on both UI surfaces:

- **OMP batch**: input `{ context?, tasks: [{ name, agent, task }] }` → a markdown batch brief followed by one collapsible card per task.
- **Claude single**: `AgentInput` `{ description, prompt, subagent_type? }` → one card, no batch-level brief.
- Each card identifies the agent when known and the subtask name while collapsed; opening it reveals the **complete** prompt.
- Malformed or oversized stored input degrades to a bounded **generic** key/value body — it must never crash, hang, or partially render a dispatch.

## Problem

Story 1.1 shipped `ToolPresentation` as a row-only subset: no `body`, no task subtask model, and both renderers rebuild the body bar locally from `presentation.badges` — which cannot produce the required `task · batch · N subtasks` / `task · single dispatch` copy. There is no shared interpretation of the two provider input shapes, so neither Legacy nor Console can render a subtask card today, and hostile stored input has no bounded fallback.

## Solution

Three layers, strictly separated (architecture AD-1/AD-3/AD-10):

1. **`packages/web/src/lib/task-normalize.ts` (new, React-free, dependency-free)**: `normalizeTaskDispatch(input)` → `NormalizedTaskDispatch { mode: 'batch'|'single', context, subtasks: TaskSubtask[] }` or `null`; `taskPromptExcerpt(prompt)` → bounded one-line preview. All-or-nothing validation under named constants: `MAX_TASK_SUBTASKS = 64`, `MAX_TASK_IDENTIFIER_CODE_UNITS = 256`, `MAX_TASK_TOTAL_TEXT_CODE_UNITS = 256 * 1024`, `MAX_TASK_EXCERPT_CODE_POINTS = 160`.
2. **`tool-presentation.ts` (extend)**: add `GenericField`, `TaskSubtaskCard extends TaskSubtask { excerpt }`, `ToolBody` (`task` | `generic`), `ToolPresentation.body`/`bodyFacts`, `ToolRowPresentation.bodyBarText`. The shared core owns ALL displayed text: normalized task → task body + `['batch', 'N subtask(s)']` or `['single dispatch']` facts + `N subagent(s)` count badge; `null` → bounded generic body (≤3 fields, scalars bounded, arrays `[n]`, objects `{…}`, never stringify) with no subagent badge. `toolRowPresentation()` composes the complete `bodyBarText` (task facts first, skip redundant count badge, append state/exit/output-state/duration in existing order, prefix resolved family).
3. **Two thin renderers**: local `TaskBody`/`GenericBody`/`SubtaskCard` markup in each shell — sharing a React component would violate Console isolation. Render `bodyBarText` verbatim; context via existing ReactMarkdown+GFM/breaks/highlight with compact overrides, `img` suppressed, no raw HTML; one nested `<details data-subtask-index="N">` per subtask (`▶ [agent ·] name — excerpt`), open card = complete prompt in `surface-inset` pre-wrap box. Outer row keeps its `event.target !== event.currentTarget` toggle guard.

Verification is via the env-gated `e2e-fake` provider extended with a `taskDispatch` scenario, a dedicated two-node workflow fixture, and a Playwright spec proving both shapes on both surfaces.

## Goals and success metrics

- Both provider shapes map to the canonical contract; neither renderer branches on provider or raw input.
- Body bars begin exactly `task · batch · N subtask(s)` (OMP) or `task · single dispatch` (Claude); applicable runtime facts follow once; the `N subagents` count is never repeated in the bar.
- Collapsed row shows singular/plural `N subagent(s)` derived only from a valid normalized dispatch.
- Every malformed/over-budget/hostile-getter input yields a bounded generic body — never a throw, partial dispatch, truncation, or JSON dump.
- Nested card mouse/Enter/Space toggles and polling rerenders do not disturb outer row state; new tool identity resets disclosures.
- Markdown cannot render raw HTML, executable URL schemes, or images; no new network request from a context block.
- Legacy at 460px reference width, Console at 520px, both also at 390px viewport and 200% zoom: summaries one line, prompts wrap, no horizontal room overflow.
- Agent/name/excerpt/prompt contrast ≥ 4.5:1 on both surfaces; focus/keyboard/expanded-state/reduced-motion have automated Playwright evidence.
- `reports/visual-acceptance.md` records measured results; sprint key `1-6-inspect-a-subagent-dispatch-and-its-subtasks` → `done`; PR closes #179.

## Non-goals

- Real provider behavior, backend/API/schema changes, migrations, generated API types, new dependencies, new design tokens.
- Other known-family bodies or generic bodies for non-task tools (Story 1.3).
- Raw payload implementation itself (Story 1.2) — but the composition contract with it is defined: readable body is the non-Raw side; Raw hides/replaces it.
- Per-subtask outcome/progress/cancellation — no such field exists in `TaskSubtask`.
- Provider labels in UI, shared cross-surface React components, virtualization, memoization, telemetry.
- Truncating or partially rendering accepted dispatches; `dropped`/`unscanned` fields or "not shown" notices — all rejected by the contract.

## Technical context

### Shared projection (exists today)

- `packages/web/src/lib/tool-presentation.ts` — React-free. `MAX_GENERIC_KEYS_SCANNED = 32` / `MAX_GENERIC_FACTS = 3` at `:15-16`; `ToolPresentation` at `:60`; `ToolRowPresentation` at `:79`; `toolPresentation()` at `:522` (has the catch-all safe fallback); `toolRowPresentation()` at `:538`. `taskHeadline()` already prefers Claude `description` → first OMP task name → context. Initialize `body: null`, `bodyFacts: []` for all existing families and both safe fallback paths.
- `packages/web/src/lib/agent-history.ts` — `buildAgentHistory()` already attaches one shared presentation per tool item; no production change expected (one optional plumbing test only).

### Renderers (parallel local `ToolHistory` implementations)

- `packages/web/src/components/workflows/NodeRoom.tsx` — `ToolHistory` at `:314`; `onToggle` guard at `:367-374`; `facts = presentation.badges.filter(...)` at `:382`; badge render at `:419`.
- `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` — `ToolHistory` at `:238`; `onToggle` at `:286-293`; `facts` at `:301`; badges at `:328`. Two Console mounts: selected room + `ConsoleExecutionHistory`.
- Both have existing `react-markdown` + GFM/breaks/highlight stacks (no raw HTML) and temporary nested Input/Output disclosures to preserve. Console isolation forbids `@/components/*` and `@/lib/api`; `@/lib` helpers/types are allowed.

### Provider shapes (verified)

- Claude: pinned `@anthropic-ai/claude-agent-sdk` 0.3.209 `AgentInput` — `description` + `prompt` required, `subagent_type` optional. Missing description is **malformed**, not a nameless card.
- OMP: external binary (no pinned TS decl). Canonical contract + stored real payload (`plans/260909-2130-live-interactive-agent-view/findings.md`) + provider tests agree on `{ tasks: [{ name, agent, task }] }`; `context` may be absent. An own `tasks` key selects OMP even if Claude-like keys coexist; a malformed `tasks` value does NOT fall through to Claude.

### Full-stack seam

- `packages/providers/src/e2e-fake/provider.ts` — `scenarioSchema` at `:45`, `emitTool` at `:47`, env-gate comment at `:261` (`ARCHON_E2E_FAKE_PROVIDER=1`), `emitTool` branch at `:320`. Extend only; test-only, no real provider contract changes.
- `e2e/lib/playwright/archon-runtime.ts` — workflow name constants at `:37-40`, `CliRunResult` at `:64`, `runHitlWorkflow()` etc. at `:114-120`, `createArchonRuntime` at `:277` (owns isolated `ARCHON_HOME`, SQLite, PIDs, cleanup). Add `runTaskDispatchWorkflow()` + fixture copy + exported constants.
- `e2e/fixtures/workflows/` — add `e2e-task-dispatch.yaml` alongside existing `e2e-hitl-run.yaml` etc.
- Sprint tracker: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:63` — `1-6-inspect-a-subagent-dispatch-and-its-subtasks: backlog` → `in-progress` when US-001 starts, `done` only in US-004 after all gates pass.
- Product authority: `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`, `test-plan.md` (CAP-4), `EXPERIENCE.md`, `DESIGN.md`, `ARCHITECTURE-SPINE.md` (AD-1/2/3/8/10/14).

### Card anatomy (from DESIGN.md component-specific rule + mockups)

`surface-elevated`, 1px `border`, 6px radius, 6px vertical / 9px horizontal padding, 5px top margin; 11.5px mono; agent `node-approval` semibold; subtask name **bold**; excerpt `text-secondary`; chevron 9px/10px rotating 90deg in 120ms (`motion-reduce` removes transition, bound to the card's own open state); focus outline 2px `accent-bright` offset -2px Legacy / +2px Console; summary ≥24px one line with `min-w-0` shrink; open content = complete prompt as React text in `surface-inset` pre-wrap box. No `title`/`id`/`aria-label` copies of payload strings; array index as row-local key; no global ids.

### Merge-order contract with Story 1.2

Check whether `plans/260918-1038-issue-175-raw-payload-toggle` has landed **in current code** before editing renderers. If not: readable body goes after the body bar, before temporary Input/Output disclosures. If yes: readable body is the non-Raw branch. Either way "no nested details" assertions mean "no Input/Output disclosures," not "no subtask cards."

### Commands

```bash
cd packages/web
bun test src/lib/task-normalize.test.ts src/lib/tool-presentation.test.ts src/lib/agent-history.test.ts
NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx
NODE_ENV=development bun test src/experiments/console/
bun run test && bun run type-check
cd ../providers && bun test src/e2e-fake/provider.test.ts
cd .. && bun run build:web && bun run lint
cd e2e && npm run typecheck && ARCHON_E2E_PROOF=1 npx playwright test -c playwright.config.ts ui/task-dispatch-body.spec.ts
cd .. && bun run validate
```

Never run root `bun test` (mock pollution; `bun run test` preserves per-package isolation). The standalone e2e package is npm, not a Bun workspace member — `npm ci`/browser setup first if uninstalled.

## Story overview

| ID     | Title                                                        | Phase | Depends on | Deliverable |
| ------ | ------------------------------------------------------------ | ----- | ---------- | ----------- |
| US-001 | Shared task-dispatch normalization and presentation contract | 1     | —          | `task-normalize.ts`, extended `tool-presentation.ts`, full unit coverage |
| US-002 | Legacy and Console task/generic body renderers               | 2     | US-001     | Matching bodies + interaction tests on both surfaces (both Console mounts) |
| US-003 | Deterministic e2e fixture (fake provider, workflow, runtime) | 3a    | —          | `taskDispatch` scenario, `e2e-task-dispatch.yaml`, `runTaskDispatchWorkflow()` |
| US-004 | Full-stack Playwright proof, visual acceptance, closeout     | 3b    | US-002, US-003 | `task-dispatch-body.spec.ts`, `visual-acceptance.md`, sprint done, PR `Closes #179` |

US-003 is independent of the web work (the fake provider emits stored tool input regardless of the UI); it is ordered third by priority but has no `dependsOn`.
