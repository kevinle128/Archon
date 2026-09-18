---
phase: 1
title: 'Phase 1: Shared normalization and presentation contract'
status: todo
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Shared normalization and presentation contract

## Goal

Build and prove the single React-free interpretation of a task dispatch. Valid OMP and Claude inputs produce the canonical task body, exact body-bar facts, and collapsed count badge. Invalid or over-budget inputs produce a bounded generic body. Nothing in this phase changes a renderer or a real provider.

## Required reading

- [plan.md](./plan.md), especially “Corrected technical decisions.”
- [reports/scout-report.md](./reports/scout-report.md).
- `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`: `ToolPresentation`, `TaskSubtask`, expanded task/generic arms, provider normalizers.
- `_bmad-output/specs/spec-agent-node-room/test-plan.md`: CAP-4 cases.
- `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`: AD-1 through AD-3, AD-8, AD-10, AD-14.
- Current `packages/web/src/lib/tool-presentation.ts` and `.test.ts`; do not rely on line numbers after rebasing.

## Files

| Path                                             | Action                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `packages/web/src/lib/task-normalize.ts`         | Create                                                                                 |
| `packages/web/src/lib/task-normalize.test.ts`    | Create                                                                                 |
| `packages/web/src/lib/tool-presentation.ts`      | Modify                                                                                 |
| `packages/web/src/lib/tool-presentation.test.ts` | Modify                                                                                 |
| `packages/web/src/lib/agent-history.test.ts`     | Add one end-to-end projection case only if it adds evidence beyond the presenter tests |
| `packages/web/src/lib/agent-history.ts`          | No change expected                                                                     |

## Contract to implement

### `task-normalize.ts`

Use descriptive exported constants so the safety policy is testable:

```ts
export const MAX_TASK_SUBTASKS = 64;
export const MAX_TASK_IDENTIFIER_CODE_UNITS = 256;
export const MAX_TASK_TOTAL_TEXT_CODE_UNITS = 256 * 1024;
export const MAX_TASK_EXCERPT_CODE_POINTS = 160;

export interface TaskSubtask {
  name: string;
  agent: string | null;
  prompt: string;
}

export interface NormalizedTaskDispatch {
  mode: 'batch' | 'single';
  context: string;
  subtasks: TaskSubtask[];
}

export function normalizeTaskDispatch(input: unknown): NormalizedTaskDispatch | null;
export function taskPromptExcerpt(prompt: string): string;
```

Rules:

1. Wrap the public normalizer in `try/catch`; a throwing getter or exotic historical value returns `null`.
2. Accept only a non-null, non-array object. An own `tasks` key selects OMP even if Claude-like keys are also present; a malformed `tasks` value does not fall through to Claude.
3. OMP requires `tasks` to contain 1–64 elements. Every element requires non-blank string `name`, `agent`, and `task`. Trim outer whitespace from identifiers; preserve the prompt text exactly. `context` is optional; absent/blank becomes `''`, a non-blank string is preserved, and any present non-string value rejects the dispatch.
4. Claude applies only when no own `tasks` key exists. Require non-blank string `description` and `prompt`; trim the description for `name`, preserve the prompt, and map absent/blank `subagent_type` to `null`. A present non-string `subagent_type` rejects the dispatch.
5. Reject an identifier longer than `MAX_TASK_IDENTIFIER_CODE_UNITS`. Before trimming or scanning string contents and before allocating the result, sum the original UTF-16 lengths of context, names, agents, and prompts while walking at most 64 entries; reject as soon as the cumulative sum exceeds `MAX_TASK_TOTAL_TEXT_CODE_UNITS`. Do not truncate normalized data and do not return a partial batch.
6. Return fresh arrays/objects so later callers cannot mutate the stored payload through the presentation.
7. `taskPromptExcerpt()` is total and deterministic. Collapse line breaks/whitespace to a readable single line, copy no more than 160 Unicode code points, and add `…` only when content was omitted. It must not split a surrogate pair or inspect beyond `MAX_TASK_TOTAL_TEXT_CODE_UNITS`; production callers pass only accepted prompts, and the direct helper still has its own bound.
8. Keep the module dependency-free. `tool-presentation.ts` imports it, so importing presenter helpers back would create a cycle. A small local record/string guard is clearer than a new abstraction.

The cap response is deliberately whole-dispatch fallback. Do not reintroduce `dropped`, `unscanned`, partial cards, “not shown” notices, or truncated prompts: none exists in the product contract, and each would make a different claim about what was delegated.

### `tool-presentation.ts`

Add the minimum body model required by this story:

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
  // existing members unchanged
  body: ToolBody | null;
  bodyFacts: string[];
}

export interface ToolRowPresentation extends ToolPresentation {
  // existing runtime members unchanged
  bodyBarText: string;
}
```

Implementation details:

- Initialize `body: null` and `bodyFacts: []` for existing families and both safe fallback paths.
- In the task branch, call `normalizeTaskDispatch(input.input)` once, then enrich its canonical `TaskSubtask[]` into `TaskSubtaskCard[]` with `taskPromptExcerpt()` so both shells receive every displayed string.
  - Batch: task body, `['batch', singularOrPlural(n, 'subtask')]`, and one `count` badge with `subagent` wording.
  - Single: task body, `['single dispatch']`, and `1 subagent`.
  - `null`: generic body from the raw input record, no subagent badge, no explicit task bar facts.
- Add a bounded, internally caught `genericBodyFields()` separate from the existing collapsed `genericFacts()` behavior. Scan at most the existing `MAX_GENERIC_KEYS_SCANNED` own keys and emit at most `MAX_GENERIC_FACTS`. Bound displayed keys and scalar values; represent an array as `[length]` and a non-null object as `{…}`. Never stringify. A non-record input or hostile property enumeration produces `[]`, preserving the generic body.
- Contain `taskHeadline()` field access inside the task branch. A malformed getter must fall back to the normal task label/headline while retaining the generic body; it must not escape to the whole-presenter fallback and lose the body.
- Do not attach that generic body to non-task tools in this story. Story 1.3 owns the broad rollout.
- In `toolRowPresentation()`, assemble badges exactly as today. For a normalized task, keep `bodyFacts` first, exclude the redundant task `count` badge, and append state/exit/output-state/duration text in existing order. Otherwise map every non-placeholder badge to text as today. Prefix the resolved family and join the final `bodyBarText` in the core. This preserves current non-task bars, keeps droppable runtime facts reachable, and prevents two shells from composing copy independently.
- Preserve `taskHeadline()`, aliases, family inference, chip logic, outcome glyphs, badge tones/order, and safe row fallback.

## Tests first

### `task-normalize.test.ts`

Write a compact table plus explicit boundary cases:

| Case                                                                                | Expected                                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| OMP with two tasks and markdown context                                             | `mode: 'batch'`, context preserved, two exact `{name, agent, prompt}` entries |
| OMP without context                                                                 | empty context, cards still valid                                              |
| Claude with `subagent_type`                                                         | `mode: 'single'`, one entry using description/prompt/type, empty context      |
| Claude without or with blank `subagent_type`                                        | one entry with `agent: null`                                                  |
| Own valid `tasks` plus Claude keys                                                  | batch mapping; proves deterministic discriminator                             |
| Missing Claude description or prompt                                                | `null`                                                                        |
| OMP missing/non-string name, agent, or task in any element                          | whole result `null`, including a batch with one valid and one invalid element |
| Empty/non-array/over-64 `tasks`                                                     | `null`                                                                        |
| Present non-string context or subagent type                                         | `null`                                                                        |
| `undefined`, `null`, primitives, arrays                                             | `null`                                                                        |
| Getter for `tasks`, `context`, or an element field throws                           | `null`, no exception                                                          |
| Exactly-at and one-over identifier limits                                           | success / `null`                                                              |
| Exactly-at and one-over cumulative text budget                                      | success / `null`; accepted prompts remain byte-for-byte unchanged             |
| Excerpt with paragraphs, repeated whitespace, emoji at the cut, exact cap, over cap | one line, code-point safe, ellipsis only when omitted                         |
| Excerpt source beyond the cumulative scan bound                                     | bounded deterministic result; no full-source scan                             |
| Same input twice                                                                    | deep-equal result                                                             |

The three canonical cases from `test-plan.md` must be individually named so coverage remains traceable.

### `tool-presentation.test.ts`

Add tests that prove:

- OMP task body, `2 subagents`, and `bodyFacts: ['batch', '2 subtasks']`.
- Singular OMP wording (`1 subagent`, `1 subtask`).
- Claude body, `1 subagent`, and `bodyFacts: ['single dispatch']`, with and without agent.
- Malformed and over-budget task input produces `{ kind: 'generic', fields: ... }`, no count badge, and never throws.
- Generic body projection is bounded, includes scalar/`[n]`/`{…}` values, bounds a hostile long key, does not stringify nested data, and internally reduces a throwing getter to an empty generic field list.
- One representative of every non-task family still has `body: null`; MCP and `safePresentation` return `body: null`/empty `bodyFacts`.
- The task body carries the canonical name/agent/prompt plus an excerpt computed by the core; neither renderer computes display text.
- `toolRowPresentation()` preserves existing complete `bodyBarText` for a failed/truncated/duration non-task row. A task row with duration produces `task · single dispatch · <duration>` exactly once; it never repeats `N subagents` in the body bar.
- Existing badge order and task headline tests remain unchanged.

### Optional `agent-history.test.ts`

Add one paired task call/result only if needed to prove that the new fields reach `AgentHistoryItem.presentation` without changing `agent-history.ts`. Do not duplicate all presenter cases here.

## Implementation order

1. Change sprint status from `backlog` to `in-progress` when implementation actually begins.
2. Add the normalizer tests and confirm they fail because the module is absent.
3. Implement the normalizer and make its tests green.
4. Add presentation tests and confirm they fail for missing body/bar fields.
5. Extend the presentation types and task branch; keep all construction sites exhaustive.
6. Run the complete `src/lib/` suite and web type-check. Fix regressions; do not weaken existing Story 1.1 assertions.

## Commands

```bash
cd packages/web
bun test src/lib/task-normalize.test.ts
bun test src/lib/tool-presentation.test.ts src/lib/agent-history.test.ts
bun test src/lib/
bun run type-check
```

## Exit criteria

- Both canonical shapes and every malformed/boundary case have deterministic unit evidence.
- The shared presentation alone decides task vs generic body, count badge, and the complete body-bar string.
- No renderer or real provider changed.
- `src/lib/` and web type-check pass.

## Risks and safeguards

- **Contract overlap with Story 1.3:** keep the generic arm canonical and narrowly attached only to malformed task-family input. Rebase onto an existing arm/helper if 1.3 lands first.
- **Accidental data loss:** accepted prompts/context are never truncated; rejected inputs take the generic path and later remain inspectable through Raw.
- **UI freeze:** array count, identifier size, cumulative text, excerpt scan, generic keys, and generic fields all have deterministic bounds.
- **Sensitive logging:** this read-only projection does not log payloads, prompts, tool names, or generated fallback values.

## Handoff to Phase 2

Phase 2 consumes only `presentation.body` and `presentation.bodyBarText`. If a renderer needs to inspect `item.input`, derive an excerpt, or compose body-bar words, the Phase 1 boundary is incomplete and must be fixed before continuing.
