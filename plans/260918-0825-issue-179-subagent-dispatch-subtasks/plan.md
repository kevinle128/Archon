---
title: 'Issue 179 subagent dispatch and subtasks'
description: 'Implementation-ready plan for Story 1.6: normalize OMP and Claude task dispatches and render their brief and collapsible subtask cards on Legacy and Console.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/179'
branch: archon/thread-fca144b4
tags: [issue-179, agent-node-room, web, tdd, epic-1, frontend, feature]
blockedBy: []
blocks: []
created: 2026-09-18
revised: 2026-09-18
---

# Issue 179 subagent dispatch and subtasks

## Goal and user outcome

When an operator expands a task-family tool row, show what was delegated and to whom:

- OMP batch input `{ context?, tasks: [{ name, agent, task }] }` becomes a batch brief followed by one card per task.
- Claude `AgentInput` `{ description, prompt, subagent_type? }` becomes one card with no batch-level brief.
- Each card identifies the agent when known and the subtask name while collapsed; opening it reveals the complete prompt.
- Legacy and Console present the same content and interaction without learning provider names.
- Malformed or deliberately oversized stored input cannot crash or hang the transcript; it uses the canonical safe generic body, while Raw remains the eventual exact-data path from Story 1.2.

This is Story 1.6 / CAP-4. It is a read-only projection of data already stored in transcript messages. It does not change a real provider, API, database, schema, generated type, or workflow runtime.

## Authority and verified evidence

The canonical product contract is the Story 1.6 acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`, CAP-4 in `_bmad-output/specs/spec-agent-node-room/SPEC.md`, and that spec's required companions. `EXPERIENCE.md` and `DESIGN.md` own behavior and visuals and take precedence over mockups where they disagree. Current code determines integration facts, not intended product behavior. See [reports/scout-report.md](./reports/scout-report.md) for the evidence trail.

Verified facts that drive the plan:

1. Story 1.6 requires both provider shapes, markdown context, one collapsible card per normalized subtask, and a safe generic body for malformed input. It depends only on shipped Story 1.1; Story 1.3 is not a prerequisite.
2. The render-neutral contract defines `TaskSubtask` as `{ name, agent, prompt }`; it has no outcome. The tool row's glyph is the only status.
3. The UX requires collapsed-row counts (`1 subagent`, `2 subagents`) and distinct task facts at the start of the body bar: `task · batch · 2 subtasks` for OMP and `task · single dispatch` for Claude. Droppable runtime facts such as duration must follow there as well. The current body bar only reuses collapsed badges, so the shared core must produce a complete `bodyBarText` rather than leaving either shell to compose it.
4. Story 1.1 shipped `ToolPresentation` without `body`. `buildAgentHistory()` already attaches one shared presentation to every tool item. Both renderers consume it, but currently render only the body bar and temporary Input/Output disclosures.
5. The current Claude SDK is pinned at `0.3.209`; its installed `AgentInput` requires `description` and `prompt` and makes `subagent_type` optional. A missing description is malformed, not a nameless valid card.
6. OMP is an external binary rather than a pinned TypeScript package. The canonical contract, a stored real payload in `plans/260909-2130-live-interactive-agent-view/findings.md`, and provider tests agree on `{ tasks: [{ name, agent, task }] }`; existing test evidence also proves `context` may be absent.
7. `AD-3` in the architecture spine requires every presentation-core operation to terminate and degrade instead of throwing. The existing `toolPresentation()` catch is necessary but not sufficient for a directly tested normalizer.
8. The env-gated `e2e-fake` provider is the existing deterministic full-stack UI seam. It currently emits only a `Read` tool, but it is explicitly test-only and can be extended without changing a real provider contract.

## Corrected technical decisions

### Shared normalization

Create `packages/web/src/lib/task-normalize.ts`, React-free and provider-name-free. It exports:

```ts
export interface TaskSubtask {
  name: string;
  agent: string | null;
  prompt: string;
}

export interface NormalizedTaskDispatch {
  mode: 'batch' | 'single';
  context: string; // empty means no batch context
  subtasks: TaskSubtask[]; // always non-empty
}

export function normalizeTaskDispatch(input: unknown): NormalizedTaskDispatch | null;
export function taskPromptExcerpt(prompt: string): string;
```

Normalization is strict and all-or-nothing:

- An own `tasks` property selects the OMP shape. It must be a non-empty array within the explicit entry limit; optional `context`, when present, must be a string; every element must contain non-empty string `name`, `agent`, and `task`. Any bad element makes the whole dispatch malformed. Do not silently drop entries or invent `agent: null` for OMP.
- Without `tasks`, Claude requires non-empty string `description` and `prompt`. An absent `subagent_type` becomes `null`; a present non-string value is malformed. Extra SDK fields such as `model` do not affect presentation.
- The function catches hostile property access and returns `null`. It never logs input, prompt text, or tool names.
- Set explicit deterministic safety bounds in this module: at most 64 batch entries, bounded task identifiers, and a cumulative budget of 262,144 UTF-16 code units across context, names, agents, and prompts. Exceeding any bound returns `null`; it never truncates a valid card or claims to show a full prompt after cutting it. The limits are presentation safety policy, not provider-contract claims, and must be named constants with boundary tests.
- `taskPromptExcerpt()` returns a whitespace-normalized, single-line, code-point-safe preview capped at 160 code points and never scans beyond the cumulative source limit. It is display metadata only; `TaskSubtask.prompt` remains complete for every accepted dispatch.

The 64-entry/262,144-code-unit limits are deliberately conservative starting values relative to the 40-row UI performance envelope and inspected examples, while giving `AD-3` a deterministic answer for adversarial history. Raw preserves diagnostic access once Story 1.2 lands. If future measured provider data exceeds either limit, adjust the constants with corpus evidence rather than partially rendering a dispatch.

### Presentation contract and generic fallback

Extend the current row subset without introducing provider logic in a renderer:

```ts
export interface GenericField {
  key: string;
  value: string;
}

export interface TaskSubtaskCard extends TaskSubtask {
  excerpt: string;
}

export type ToolBody =
  | { kind: 'task'; context: string; subtasks: TaskSubtaskCard[] }
  | { kind: 'generic'; fields: GenericField[] };

export interface ToolPresentation {
  // existing fields
  body: ToolBody | null;
  bodyFacts: string[];
}

export interface ToolRowPresentation extends ToolPresentation {
  // existing runtime fields
  bodyBarText: string;
}
```

- A normalized batch maps each canonical `TaskSubtask` to a `TaskSubtaskCard` by adding the shared excerpt, sets `bodyFacts` to `['batch', 'N subtasks']`, and adds the collapsed count badge `N subagent(s)`.
- A normalized Claude dispatch makes the same card model, sets `bodyFacts` to `['single dispatch']`, and adds `1 subagent`.
- A task-family input that does not normalize sets `body` to the canonical generic arm and has no subagent badge. Project at most three own input fields through a bounded body-only helper: scalar values become bounded text, arrays become `[n]`, and objects become `{…}`. This is the minimum generic support explicitly required by Story 1.6; do not attach generic bodies to other families in this story. Story 1.3 later reuses and broadens the same arm.
- Non-task families keep `body: null` and their current body-bar behavior. `toolRowPresentation()` owns the final `bodyBarText`: for a normalized task, keep `bodyFacts` first, skip the redundant task `count` badge, then append state/exit/output-state/duration badge text in existing order; otherwise preserve every non-placeholder badge fact. It prefixes the resolved family and joins the complete string once. Renderers consume that string verbatim, satisfying architecture AD-10.
- Keep the existing task headline priority. Do not change alias resolution, outcome derivation, badge ordering, full-output loading, or other families.

This resolves the draft's two largest contract errors: `body: null` is not a safe generic body, and `task · N subagents` is not the accepted task-fact copy.

### Two thin renderers

Each renderer gets small local `TaskBody`, `GenericBody`, and `SubtaskCard` markup helpers. Sharing a React component would cross the Console isolation boundary; content selection remains shared in `lib/`.

- Render `presentation.bodyBarText` verbatim. For task rows the canonical task facts come first and any runtime facts follow once.
- For a task body, render non-empty `context` first with the existing `react-markdown`/GFM/breaks/highlight pipeline, context-specific compact spacing, and no raw HTML. Suppress `img` entirely and test unsafe link schemes so mounting stored markdown cannot create an image beacon or script URL (closed `<details>` children are still mounted).
- Render one native nested `<details>` card per subtask. The summary contains a decorative 9px chevron, optional agent, `·`, bold subtask name, `—`, and the already-computed bounded excerpt. If the Claude agent is unknown, omit the agent and separator but keep the name.
- The open card adds the complete prompt as React text in a pre-wrapped `surface-inset` box. No prompt, name, or agent is copied to `title`, `id`, or an explicit `aria-label`.
- Preserve the outer row's `event.target !== event.currentTarget` toggle guard; nested card toggles must not mark or flip the outer row.
- For a generic body, render the already-projected key/value rows only. A zero-field generic body may contain no list rows; do not fabricate payload content.
- Insert the readable body after the body bar and before the current Input/Output bridge. If Story 1.2 has landed, the readable body is the non-Raw side of its swap. In either merge order, Raw hides/replaces the readable body but does not delete it, and tests saying “no nested details” must mean “no Input/Output disclosures,” not “no subtask cards.”

### Visual authority and resolved inconsistency

`DESIGN.md`'s component-specific subtask rule and the reviewed mockup win over its earlier general sentence that everything except the agent is regular weight. The required card is:

- `surface-elevated`, 1px `border`, 6px radius, 6px vertical / 9px horizontal padding, 5px top margin;
- 11.5px mono content; agent in `node-approval` semibold, subtask name bold, excerpt in `text-secondary`;
- same chevron and 120ms rotation as the tool row, with no transition under reduced motion;
- visible 2px `accent-bright` focus outline, offset -2px Legacy and +2px Console;
- card summary at least 24px high; prompt box uses `surface-inset` and wraps without horizontal room overflow.

The mockup's simple context is one line, but the acceptance criterion says markdown. Multi-block markdown may wrap; compact spacing must prevent headings/lists from breaking transcript density.

The mockup task examples omit duration from the open body bar, while `EXPERIENCE.md` and architecture AD-10/AD-14 require any runtime badge that can disappear under width pressure to remain available there. The higher-authority behavior/architecture rule wins: task facts lead, applicable runtime facts follow, and the redundant `N subagents` count is not repeated.

## Scope

### In scope

- Shared task normalizer, task/generic body arms, complete body-bar text, and task count badge.
- Legacy and Console body rendering, including both Console mounts.
- Deterministic fake-provider task fixtures and a full-stack Playwright scenario for both provider shapes and both UI surfaces.
- Focused unit/component tests, responsive/a11y/visual evidence, full validation, sprint-status lifecycle, and PR closeout.

### Out of scope

- Real provider behavior, backend/API/schema changes, migrations, generated API types, new dependencies, or new design tokens.
- Other known-family bodies and generic bodies for non-task tools (Story 1.3).
- Raw implementation itself (Story 1.2), todo state, diffs, or occurrence navigation.
- Per-subtask result/outcome, cancellation, or progress; no such field exists in `TaskSubtask`.
- Provider labels in the UI, shared cross-surface React components, virtualization, memoization, or telemetry.

## End-to-end behavior

```text
stored tool call input
        |
        v
buildAgentHistory -> toolRowPresentation -> toolPresentation
                                            |
                                  family === task
                                            |
                              normalizeTaskDispatch
                                 /              \
                    valid batch/single       malformed/over-budget
                           |                         |
                 task body + exact bar       bounded generic body
                 facts + count badge         no task count badge
                           \                         /
                            shared AgentHistoryItem
                                      |
                    +-----------------+-----------------+
                    v                                   v
             Legacy NodeRoom                 ConsoleAgentHistoryList
             body bar verbatim               body bar verbatim
             context markdown                context markdown
             nested subtask cards            nested subtask cards
```

## Acceptance criteria

- [ ] OMP batch, Claude single, and Claude-without-`subagent_type` match the canonical mapping; neither renderer branches on provider or raw input.
- [ ] OMP body bars begin `task · batch · N subtasks`; Claude body bars begin `task · single dispatch`. Applicable runtime facts follow once, context/card behavior matches each shape, and the redundant subagent count is not repeated in the bar.
- [ ] The collapsed row carries singular/plural `N subagent(s)` derived only from a valid normalized dispatch.
- [ ] Every collapsed card names the subtask and the agent when known; opening it reveals the complete accepted prompt preformatted. No per-card status is invented.
- [ ] Invalid elements, mixed/wrong field types, empty required fields, hostile getters, over-limit arrays, or over-budget text produce a bounded generic body and never throw or partially render a dispatch.
- [ ] The generic fallback shows at most three projected fields, never serialized JSON; arrays/objects are only `[n]`/`{…}` markers. Empty generic projection is allowed.
- [ ] Nested card mouse/Enter/Space toggles and polling rerenders do not alter the outer row's controlled state; a new tool identity resets its own disclosures.
- [ ] Markdown does not render raw HTML, executable URL schemes, or images; no new network request originates from a context block.
- [ ] Legacy matches at its 460px reference room width and Console at its 520px mockup width; each also works at 390px viewport width and under 200% zoom. Summaries remain one line, prompts wrap, and the room gains no horizontal overflow.
- [ ] Agent/name/excerpt/prompt contrast is at least 4.5:1 on both surfaces; focus, keyboard order, expanded state, and reduced-motion behavior have automated Playwright evidence.
- [ ] Existing Input/Output or Raw/full-output behavior remains intact according to whichever sibling state is present; Console isolation stays green.

## Phases

| #   | Phase                                                                                         | Depends on          | Deliverable                                                                      |
| --- | --------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| 1   | [Shared normalization and presentation contract](./phase-01-start.md)                         | Story 1.1 (shipped) | Strict normalizer, task/generic arms, complete body-bar text, focused unit tests |
| 2   | [Legacy and Console body renderers](./phase-02-two-surface-renderers.md)                      | Phase 1             | Matching task/generic bodies and interaction tests on both surfaces              |
| 3   | [Deterministic full-stack verification and closeout](./phase-03-verification-and-closeout.md) | Phases 1–2          | E2E fake fixture, Playwright proof, validation record, sprint closeout           |

## Global file inventory

| Path                                                                                       | Action                                                                                                    |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/task-normalize.ts`                                                   | Create                                                                                                    |
| `packages/web/src/lib/task-normalize.test.ts`                                              | Create                                                                                                    |
| `packages/web/src/lib/tool-presentation.ts`                                                | Modify                                                                                                    |
| `packages/web/src/lib/tool-presentation.test.ts`                                           | Modify                                                                                                    |
| `packages/web/src/lib/agent-history.test.ts`                                               | Modify only if needed to prove presentation plumbing; no production change expected in `agent-history.ts` |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                       | Modify                                                                                                    |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                                  | Modify                                                                                                    |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                            | Modify                                                                                                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`      | Modify                                                                                                    |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Modify                                                                                                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Modify                                                                                                    |
| `packages/providers/src/e2e-fake/provider.ts` and `.test.ts`                               | Extend the env-gated test fixture only                                                                    |
| `e2e/fixtures/workflows/e2e-task-dispatch.yaml`                                            | Create                                                                                                    |
| `e2e/lib/playwright/archon-runtime.ts`                                                     | Seed/run the fixture                                                                                      |
| `e2e/ui/task-dispatch-body.spec.ts`                                                        | Create                                                                                                    |
| `plans/260918-0825-issue-179-subagent-dispatch-subtasks/reports/visual-acceptance.md`      | Create after verification                                                                                 |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`                 | `backlog -> in-progress` at start, `done` only after all gates pass                                       |

Read-only unless evidence changes: `packages/web/src/lib/agent-history.ts`, `pair-tool-transcript.ts`, room parents, server routes, schemas, migrations, real provider adapters, generated types, and theme tokens.

## Validation strategy

Run the narrowest tests first, then the repository gates:

```bash
cd packages/web
bun test src/lib/task-normalize.test.ts src/lib/tool-presentation.test.ts src/lib/agent-history.test.ts
NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx
NODE_ENV=development bun test src/experiments/console/
bun run test
bun run type-check

cd ../../packages/providers
bun test src/e2e-fake/provider.test.ts

cd ../../e2e
npm run typecheck
npx playwright test -c playwright.config.ts ui/task-dispatch-body.spec.ts

cd ..
bun run validate
```

Never run root `bun test`. The standalone Playwright package is not part of `bun run validate`, so its focused command is an explicit required gate.

## Compatibility, rollout, and rollback

- No database migration, persisted-shape rewrite, server deployment step, flag, or configuration key is needed. Historical rows improve when the web bundle updates.
- The task body and test-fixture support land as one focused change. Rollback is a normal revert; persisted transcript data remains untouched.
- If Story 1.2 or 1.3 lands first, rebase onto its final union/body slot instead of recreating competing abstractions. Run both stories' focused tests after conflict resolution.
- Mark sprint status `done` only after unit, component, Playwright, and `bun run validate` all pass. Use the PR template and `Closes #179`; target the repository's current working integration branch as verified at implementation time.

## Risks and non-blocking assumptions

- The 64-entry and 262,144-code-unit safety budgets are UI policy chosen to satisfy `AD-3`; the repository has no provider-wide maximum. They reject the whole dispatch rather than silently omit data. Revisit only with measured payload evidence.
- OMP is an external executable, so compatibility is based on the canonical contract plus stored/tested payloads, not a pinned declaration file. Unknown future shapes safely use the generic arm.
- Story 1.2 and this story edit the same two body regions. The required final composition is explicit above, and both merge orders are testable; it is coordination risk, not a blocker.
- No unresolved design conflict remains. The component-specific subtask typography rule resolves the one internal DESIGN wording inconsistency.

## Definition of done

- [ ] Every acceptance criterion has automated evidence or a recorded, reproducible visual measurement.
- [ ] Focused web/provider/Playwright tests and `bun run validate` pass without warnings or skipped task-dispatch scenarios.
- [ ] `reports/visual-acceptance.md` records both surfaces, both provider shapes, computed geometry/contrast, keyboard/focus/motion, and responsive/zoom results.
- [ ] No real provider, API, schema, generated type, or unrelated family behavior changed.
- [ ] Sprint status is `done`, the implementation is reviewable as one revertible unit, and the PR closes #179.

<!-- slug: issue-179-subagent-dispatch-subtasks -->
