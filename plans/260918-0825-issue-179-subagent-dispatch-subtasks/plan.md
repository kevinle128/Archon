---
title: 'Issue 179 subagent dispatch and subtasks'
description: 'Implementation-ready plan for Story 1.6: a task-family tool row expands to batch context as markdown plus one collapsible card per normalized subtask, on Legacy and Console.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/anhle128/Archon/issues/179'
branch: archon/thread-fca144b4
tags: [issue-179, agent-node-room, web, tdd, epic-1, frontend, feature]
blockedBy: []
blocks: []
created: 2026-09-18
---

# Issue 179 subagent dispatch and subtasks

## Goal and user outcome

Story 1.6 lets an operator open a `task`-family tool row and read what was delegated and to whom: the batch brief (`context`) as markdown when the provider sent one, then one collapsible card per subtask naming the agent and the subtask, with the full prompt behind the card. Both provider shapes — OMP's batch `{ context, tasks: [{ name, agent, task }] }` and Claude's single `Agent` `{ description, prompt, subagent_type? }` — normalize at the edge to one `TaskSubtask[]`, so neither renderer learns a provider name. Malformed task data degrades to the bar-only body without throwing.

This is FR/CAP-4 from the Agent Node Room epic. It is a presentation-only slice over data already stored: no schema, migration, backend, API, provider, or generated-type change.

## Evidence and authority

Order of precedence when sources differ: Story 1.6 AC (`epics.md:347-369`) → CAP-4 (`SPEC.md:66-68`) → `tool-presentation-contract.md` (`:44-52`, `:178`, `:214-226`) and `test-plan.md:55-59` → `EXPERIENCE.md` (`:82`, `:123`, `:340`) → `DESIGN.md` (`:248-254`, `:608-611`) → mockup `key-transcript-states.html:293-311` → current code and tests. Every `file:line` is verified in [reports/scout-report.md](./reports/scout-report.md).

## Resolved source conflicts and decisions

- **Where the body lives — `ToolPresentation.body`, task arm only.** The contract puts the body on `ToolPresentation` (`:44`) and normalizers in `lib/` (`:214`). Story 1.1 shipped the row subset without `body`. This story adds `body: ToolBody | null` where `ToolBody` currently has one arm, `{ kind: 'task'; context: string | null; subtasks: TaskSubtask[]; unscanned: number; dropped: number }`, assembled inside `resolveToolPresentation` so AC3 ("never crashes") inherits the existing try/catch. `null` means "no family arm yet": renderers show the body bar only. The `generic` arm and every other family arm stay in Story 1.3 — both stories in flight would otherwise collide on the same switch.
- **"Safe generic body" for this story = the bar-only body.** Story 1.2's owner decision "Interim expanded body — accept bar-only" (`plans/260918-1038-issue-175-raw-payload-toggle/plan.md:54`) already defines what a row without a family arm shows. A malformed dispatch yields `body: null` and renders exactly like any non-task row today. Story 1.3 replaces that with the `generic` key-value arm.
- **`context` is `string | null`.** The contract types it `string` (`:44`) but the behaviour text says it renders "only when the provider sends one" and Claude has no batch level (`:226`). `null` is the honest type; renderers render the markdown block only when non-null.
- **`TaskSubtask` gains `excerpt`, and every string is capped.** The card's collapsed line needs a bounded one-line prompt excerpt (`EXPERIENCE.md:123`, `DESIGN.md:609`). Deriving it in JSX would duplicate logic across two surfaces and risk putting the whole prompt into the `<summary>` accessible name (forbidden since Story 1.1). The module finds the first non-empty line inside a 4096-code-unit scan window, then cuts it to `MAX_TASK_EXCERPT_CODE_POINTS` (160) code points with a trailing `…` — a genuine one-liner, so a long single-paragraph prompt can never leak into the accessible name. `prompt` and `context` are capped at 65536 code points (`…` when cut) so a multi-megabyte string cannot force an unbounded `<pre>` layout; `name`/`agent` at 200. All cuts are code-point-safe (never `String.prototype.slice`), mirroring `truncateCodePoints`. The shape is `{ name, agent, prompt, excerpt }`; the contract's three fields are unchanged. <!-- Updated: Red Team 2026-09-18 — findings S2/S3/S4 -->
- **Shape precedence: `tasks[]` wins.** A payload with an array `tasks` is an OMP batch; otherwise a string `prompt` is a Claude single dispatch; otherwise `null`. Real providers never send both; the rule is documented and tested. `taskHeadline` (which prefers `description`) is unchanged.
- **Malformed elements are dropped individually; caps are never silent; the two are never conflated.** An OMP element that is not a record or lacks a string `name` **and** string `task` is dropped (`agent` non-string → `null`) and counted in `dropped`. Scanning stops after `MAX_TASK_SUBTASKS` (64) elements; the remainder is counted in `unscanned`. The body renders `N subtasks not shown` for `unscanned` and `N malformed subtasks skipped` for `dropped`. The `N subagent(s)` badge counts `subtasks.length + unscanned` only — a `null` element was never a dispatch. Zero valid subtasks → `body: null`. <!-- Updated: Red Team 2026-09-18 — findings S5/A3/F4 -->
- **Claude `name` falls back to `''`.** A Claude entry requires a string `prompt`; `name` is `description` when it is a non-empty string, else `''`, and the renderer omits the name segment and its separator. `agent` is `subagent_type` when a non-empty string, else `null`.
- **Badge `N subagent(s)` is in scope; bar words `batch` / `single dispatch` are not.** The mockup rows show `2 subagents` and `1 subagent · 2m 04s` (`:295`, `:307`; microcopy `EXPERIENCE.md:78`). A content badge `{ kind: 'count', text: '2 subagents' }` (singular for 1) comes from the normalized body, so the body bar reads `task · 2 subagents · …`. The mockup bar text `task · batch · 2 subtasks` needs a bar-facts channel that does not exist; it is a recorded deviation deferred to Story 1.3's bar work.
- **Context renders as markdown, images suppressed.** `DESIGN.md:610` says "one text-secondary line"; the AC (`epics.md:361`) and the contract (`:178`) say markdown. AC wins: `ReactMarkdown` with the existing plugin stack, styled text-secondary, plus a context-only `img: () => null` override so a model-authored brief cannot fire a network request when the row opens. `react-markdown` ^9's default `urlTransform` already blanks `javascript:` hrefs. <!-- Updated: Red Team 2026-09-18 — finding S1 -->
- **Cards are nested native `<details>`.** Uncontrolled, keyed by index within the item, the same 9px chevron with 120ms rotation and `motion-reduce`, agent in node-approval semibold, `·`, name bold, `—` excerpt in text-secondary; `agent: null` drops the agent segment and its `·`. Open state adds the full prompt preformatted in a `surface-inset` body box inside the card. The outer row's `event.target !== event.currentTarget` guard already ignores nested toggles.
- **Insertion point in both repository states, and both merge orders.** Today: after the body bar (`NodeRoom.tsx:432-434`, `ConsoleAgentHistoryList.tsx:341-343`) and before the Input/Output bridge, which this story leaves untouched (Story 1.2 removes it). After Story 1.2 lands: inside the swap slot as `rawOpen ? <raw box> : <TaskBody/>`. Each surface keeps its task body in one small local function so the merge conflict is a single line. Because 1.2's plan only anticipated landing first, a reciprocal "Coordination with Story 1.6" note was added to `plans/260918-1038-issue-175-raw-payload-toggle/plan.md` on 2026-09-18: keep `TaskBody`/`SubtaskCard`, rewire the conditional into the swap slot, and scope 1.2's "no `<details>` inside a tool row" assertions to exclude `[data-subtask-index]` cards. <!-- Updated: Red Team 2026-09-18 — findings F2/F3 -->
- **No E2E in this story.** The `e2e-fake` provider emits only a fixed `Read` call (`packages/providers/src/e2e-fake/provider.ts:27-28`); a dispatch fixture needs a `@archon/providers` change outside this slice. Component tests on both surfaces (and both Console mounts) are the gate; visual evidence comes from a real dispatch run on a scratch `ARCHON_HOME` (preferred — it also captures a genuine payload for the shape preflight) or a static-markup render, never from an orphan message row inserted by hand. <!-- Updated: Red Team 2026-09-18 — finding F1 -->

## Scope

### In scope

- `packages/web/src/lib/task-normalize.ts` — pure, bounded, never-throwing normalizer plus types; unit tests as `task-normalize.test.ts` (the name `test-plan.md:55` fixes).
- `tool-presentation.ts` — `body` field, task arm, `N subagent(s)` badge; unit tests.
- Task body rendering on Legacy `NodeRoom.tsx` and Console `ConsoleAgentHistoryList.tsx` with identical anatomy and surface-specific tokens; component tests on both surfaces and both Console mounts.
- Visual, keyboard, contrast, and screen-reader evidence; `bun run validate`; `sprint-status.yaml` → `done`.

### Out of scope

- Every other family body arm, the `generic` arm, Raw toggle, bridge removal (Stories 1.2–1.5, 1.7).
- Per-subtask outcome (`TaskSubtask` carries none; the row glyph is the only status — `EXPERIENCE.md:340`).
- Backend, providers, schema, API, generated types, E2E fixture changes, new design tokens, a shared React component across surfaces.

## End-to-end design

```text
AgentHistoryItem (kind: 'tool') ── name / input / output
        |
        |  toolPresentation() ── family 'task' ──> normalizeTaskDispatch(input)   ← lib/task-normalize.ts
        |                                            └─ TaskDispatch | null  ──> body + 'N subagents' badge
        v
<details data-tool-id>                        (Story 1.1, unchanged)
  <summary>… chip · headline · badges …</summary>
  <div body>
    <div body-bar>task · 2 subagents · 2m 04s</div>
    {body?.kind === 'task' ? <TaskBody/> : null}      ← this story; post-1.2 it sits in the Raw swap slot
        ├─ context markdown (text-secondary)          only when context !== null
        ├─ <details card> ▶ agent · name — excerpt     one per subtask; open → <pre body-box>{prompt}</pre>
        └─ "N subtasks not shown" / "N malformed subtasks skipped"   only when unscanned / dropped > 0
    …Input/Output bridge (1.1, untouched) · View full output · error/Retry…
  </div>
</details>
```

## Acceptance criteria

- [ ] OMP `{ context, tasks: [a, b] }` → two `TaskSubtask` entries and a rendered context block; Claude `{ description, prompt, subagent_type }` → exactly one entry (`name` = description, `agent` = subagent_type) and no context block; Claude without `subagent_type` → `agent: null` and still renders (`test-plan.md:56-58`).
- [ ] Expanding a task row on Legacy and Console shows the context markdown (when present) then one collapsible card per subtask; a card's collapsed line names the agent (when known) and the subtask; opening a card reveals the full prompt preformatted; opening or closing a card never marks the outer row touched or flips its `open`.
- [ ] Malformed payloads (non-object input, `tasks` not an array, elements missing fields, oversized arrays, oversized strings, adversarial keys, throwing getters) never throw anywhere in `buildAgentHistory` or either renderer; the row renders the bar-only body; every scan and every emitted string is bounded, and caps surface as `N subtasks not shown` / `N malformed subtasks skipped`.
- [ ] The `N subagent(s)` badge appears on the row and in the body bar for a normalized dispatch, counts real dispatches only (never malformed elements), and is absent when `body` is `null`.
- [ ] No serialized JSON, provider name, or prompt text beyond the 160-code-point excerpt appears in any `<summary>` accessible name; an expanded row fires no network request from its context block; Console imports nothing new from `@/components/` or `@/lib/api` (`console-isolation.test.ts` stays green).
- [ ] Card visuals match `DESIGN.md:608-611` on both surfaces: `surface-elevated`, 1px border, 6px radius, 6px/9px padding, 5px top margin, agent 11.5px/600 node-approval; contrast of card text ≥ 4.5:1 recorded; card summary ≥ 24px tall; focus ring `--accent-bright` (offset −2px Legacy / +2px Console); chevron rotation respects reduced motion.

## Phases

| # | Phase | Depends on | Output |
| --- | --- | --- | --- |
| 1 | [Shared task contract and red unit tests](./phase-01-start.md) | None | `task-normalize.ts` + tests, `body`/badge on `ToolPresentation` + tests |
| 2 | [Legacy and Console renderers](./phase-02-two-surface-renderers.md) | Phase 1 | Red component tests then green task body on both surfaces |
| 3 | [Verification and closeout](./phase-03-verification-and-closeout.md) | Phases 1–2 | Visual/a11y evidence, `bun run validate`, sprint status, report |

Deep mode: Phase 1 is planned in full; Phases 2–3 are planned to implementation detail but each gets a dedicated scout pass during cook to re-verify the insertion lines against whatever Story 1.2 has merged by then.

## Cross-plan dependencies

| Relationship | Plan | Status | Note |
| --- | --- | --- | --- |
| Coordinates with | `260918-1038-issue-175-raw-payload-toggle` | pending | Same two body regions; whichever lands second rebases the task body into the Raw swap slot (`rawOpen ? raw : <TaskBody/>`). Reciprocal note added to that plan's `plan.md` so 1.2 preserves the cards and re-scopes its "no nested `<details>`" assertions if 1.6 lands first. |
| Builds on | `260917-1011-issue-174-readable-tool-call-row` | shipped (#197) | Row model, toggle guard, test scaffolds. |

## Global file inventory

| Path | Action | Test impact |
| --- | --- | --- |
| `packages/web/src/lib/task-normalize.ts` | Create (~120 lines) | New `task-normalize.test.ts` |
| `packages/web/src/lib/task-normalize.test.ts` | Create | CAP-4 table + malformed/bounded cases |
| `packages/web/src/lib/tool-presentation.ts` | Modify (~30 lines) | `tool-presentation.test.ts` additions |
| `packages/web/src/lib/tool-presentation.test.ts` | Modify | `body`/badge table, `body: null` for every other family |
| `packages/web/src/lib/agent-history.test.ts` | Modify (small) | Item carries `presentation.body` for a task card |
| `packages/web/src/components/workflows/NodeRoom.tsx` | Modify (~70 lines) | `NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx` |
| `packages/web/src/components/workflows/NodeRoom.test.tsx` | Modify | Static anatomy of context + cards |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx` | Modify | Card toggle isolation, keyboard, identity reset |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | Modify (~70 lines) | `ConsoleNodeRoom.test.tsx`, `ConsoleExecutionHistory.test.tsx` |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` | Modify | Same contract on the selected room |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Modify (one case) | Inline history mount renders cards too |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | Modify (Phase 3, `:63`) | none |
| `plans/260918-0825-issue-179-subagent-dispatch-subtasks/reports/visual-acceptance.md` | Create (Phase 3) | none |

Read-only: `agent-history.ts` (its call already passes `input`), `pair-tool-transcript.ts`, `NodeTranscriptPane.tsx`, `ConsoleNodeRoom.tsx`, `ConsoleExecutionHistory.tsx`, server, providers, schemas, generated types, theme tokens. Stop and revise the plan before touching them.

## Validation and proof

- Unit: `cd packages/web && bun test src/lib/task-normalize.test.ts src/lib/tool-presentation.test.ts src/lib/agent-history.test.ts`.
- Component: `cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx` and `NODE_ENV=development bun test src/experiments/console/`.
- Full gates: `cd packages/web && bun run test && bun run type-check`, then `bun run validate` at the root. Never run root `bun test`.

## Rollout and rollback

Web-only presentation change; no flag or migration. Roll back the module, both renderers, and tests as one unit. If one surface fails acceptance, fix both together — never ship an asymmetric task body.

## Red Team Review

### Session — 2026-09-18
**Reviewers:** Security Adversary (Fact Checker), Assumption Destroyer (Contract Verifier), Failure Mode Analyst (Fact Checker + Contract Verifier) — Standard tier, 3 phases.
**Findings:** 14 raw → 10 after dedup (10 accepted, 0 rejected; 3 accepted with modification)
**Severity breakdown (post-dedup, as adjudicated):** 1 Critical, 4 High, 5 Medium

| # | Finding | Reviewer | Severity | Disposition | Applied To |
|---|---------|----------|----------|-------------|------------|
| S1 | Markdown `context` can emit `href`/`src` from payload text; plan claimed "no payload text reaches attributes" | Security | High (Critical as filed) | Accept (modified): `javascript:` is already blanked by `react-markdown` ^9 `defaultUrlTransform` (`packages/web/package.json:43`); the real gap is image beacons → context-only `img: () => null`; security wording corrected | Phase 2, plan.md |
| S2 | No length cap on `prompt`/`context` before `<pre>`/markdown render | Security | Medium (Critical as filed; the 1.1 bridge already mounts the whole input JSON per row, so exposure is not new) | Accept: 65536-code-point cap with `…` on both; `name`/`agent` at 200 | Phase 1, plan.md |
| S3 | 4096-unit excerpt leaks near-whole single-line prompts into the always-present `<summary>` accessible name | Security | High | Accept: 160-code-point excerpt cap; 4096 stays a scan window only | Phase 1, Phase 2 tests, plan.md |
| S4 | Excerpt slice by UTF-16 code unit can split a surrogate pair | Security | Medium | Accept: code-point-safe local truncation, surrogate test rows | Phase 1 |
| S5 / A3 / F4 | `omitted` conflates malformed drops with cap overflow and inflates the `N subagents` badge | all three | High | Accept: split into `unscanned` + `dropped`; badge counts `subtasks + unscanned`; two not-shown lines; malformed-mix badge test | Phase 1, Phase 2, plan.md |
| A1 | Phase 1 said to reuse `firstNonEmptyLine`/`truncateCodePoints`, which are not exported and have incompatible over-cap semantics, while also forbidding the import | Assumptions | Critical (contradiction inside the phase) | Accept: local helpers, wording fixed | Phase 1 |
| A2 | Card keyboard test omits the happy-dom keydown+click workaround the repo already documents (`LegacyNodeRoom.test.tsx:1156-1158`) | Assumptions | High | Accept | Phase 2 |
| A4 | Provider payload shapes rest on spec prose citing a vendored `.d.ts` this session could not open | Assumptions | Medium | Accept: Phase 1 preflight reads both SDK types from the implementing session; Phase 3's preferred evidence path captures a real Claude payload | Phase 1, Phase 3 |
| F1 | Phase 3's "insert a `workflow_node_messages` row" fixture violates the `NOT NULL` FK (`migrations/000_combined.sql:747`) and the route's run check (`api.ts:5278-5279`) | Failure | Critical | Accept: dropped; preferred path is a throwaway dispatch run on a scratch `ARCHON_HOME`, fallback static markup | Phase 3, plan.md |
| F2 / F3 | Sibling #175 plan never anticipates 1.6 landing first, and its "no `<details>` inside a tool row" assertions contradict subtask cards | Failure | High | Accept: reciprocal "Coordination with Story 1.6" section added to `plans/260918-1038-issue-175-raw-payload-toggle/plan.md`; Phase 2 scout pass re-scopes the assertions when 1.2 lands first | Phase 2, Phase 3, sibling plan |
| F5 | Console double mount (`ConsoleInspectPane.tsx:264-266`, `:313`) duplicates `data-subtask-index` on one page; no combined-mount test | Failure | Medium | Accept (modified): the attribute is documented as row-scoped, no `id` is emitted, all test queries scope inside `details[data-tool-id]`; a combined `ConsoleInspectPane` mount test is disproportionate for an attribute that carries no cross-reference | Phase 2 |

**Verification results (reviewer fact checks):** 39 claims sampled across the three reviewers — 37 verified, 0 failed, 2 unverified (the vendored SDK type file, blocked by the session's `node_modules` hook, now a Phase 1 preflight; and an off-by-one in the `e2e-fake/provider.ts:27-29` range, corrected to `:27-28`). The Contract Verifier enumerated all 5 `ToolPresentation` construction sites (all inside `tool-presentation.ts`) and 11 test files that build tool items only through `buildAgentHistory`/`toolRowPresentation`, confirming the "additive `body` field, renderers compile untouched" claim.

### Whole-Plan Consistency Sweep
- Searched all plan files for the superseded terms `omitted`, `4096` as a display length, "reuse `firstNonEmptyLine`", "inserted `workflow_node_messages` row", and "No payload text reaches attributes"; each occurrence was replaced or re-scoped (`4096` now appears only as the excerpt scan window).
- `plan.md` decisions, acceptance criteria, cross-plan table, and the "End-to-end design" sketch agree with Phase 1's contract (`unscanned`/`dropped`, 160/65536/200 caps) and Phase 2's DOM contract (two not-shown lines, `img` suppression, row-scoped `data-subtask-index`).
- The sibling #175 plan carries the reciprocal note; no contradiction remains between the two plans' treatment of nested `<details>`.
- No unresolved contradictions.

## Definition of done

- [ ] Every acceptance criterion has passing automated evidence or a named manual record in `reports/visual-acceptance.md`.
- [ ] `bun run validate` passes; `console-isolation.test.ts` stays green.
- [ ] `sprint-status.yaml:63` reads `1-6-inspect-a-subagent-dispatch-and-its-subtasks: done`; PR uses the repo template and `Closes #179`.

<!-- slug: issue-179-subagent-dispatch-subtasks -->
