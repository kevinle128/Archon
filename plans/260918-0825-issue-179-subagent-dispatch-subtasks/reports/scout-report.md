# Scout report — Story 1.6 (issue #179): subagent dispatch and its subtasks

Written 2026-09-18 from direct repository reads. No researcher agents were spawned: the domain is contract-complete inside the repo (spec, UX docs, mockup, shipped Story 1.1 code), and every claim below carries a `file:line` from the working tree at `0fb1fd04`.

## Authority chain

1. Story 1.6 AC — `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:347-369`.
2. CAP-4 — `_bmad-output/specs/spec-agent-node-room/SPEC.md:66-68`.
3. Contract — `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md` (`body` union `:44`, `TaskSubtask` `:48-52`, `task` body row `:178`, normalizer table `:214-226`).
4. Test plan — `_bmad-output/specs/spec-agent-node-room/test-plan.md:55-59` (`task-normalize.test.ts`).
5. UX behaviour — `ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md:123` (Subtask card), `:82` (microcopy `batch · 2 subtasks` / `single dispatch`), `:78` (`1 subagent · 2m 04s` / `2 subagents`), `:340` (Flow 1 task row).
6. UX visuals — `DESIGN.md:248-254` (subtask-card tokens), `:608-611` (card anatomy; card is itself a `<details>`), `:95-97` (`subtask-agent` 11.5px/600), `:119` (`subcard-pad: 6px 9px`), `:103` (radius 6px), `:469` (node-approval on surface-elevated 6.5:1 / 6.8:1).
7. Mockup — `mockups/key-transcript-states.html:293-311` (§D task arms), `:76-78` (`.sub-card`, `.ag`, `.ctx` CSS).

## Shipped Story 1.1 surface this story builds on

- `packages/web/src/lib/tool-presentation.ts` — `ToolPresentation` is the "row subset" without `body` (`:59-70`); `task` aliases (`:141-144`); `taskHeadline` prefers `description`, then `tasks[0].name`, then `context` (`:384-396`); `firstNonEmptyLine` (`:256-272`) and `truncateCodePoints` (`:275-285`) are the bounded text helpers; `resolveToolPresentation` (`:419-511`) assembles the presentation inside `toolPresentation`'s try/catch (`:522-528`) so a throw degrades to `safePresentation`.
- `packages/web/src/lib/agent-history.ts` — `toToolItem` calls `toolRowPresentation` once per card (`:186-189`); the item exposes `name`, `input`, `output`, `presentation`.
- Legacy renderer `packages/web/src/components/workflows/NodeRoom.tsx` — `ToolHistory` (`:314-476`); body container `:431`; body bar `:432-434`; Input/Output bridge `:435-450`; `View full output` `:451-459`; toggle guard `:367-376`; markdown stack `REMARK_PLUGINS`/`REHYPE_PLUGINS`/`MARKDOWN_COMPONENTS` (`:42-…`).
- Console renderer `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` — `ToolHistory` (`:238-385`); body container `:340`; bridge `:344-359`; `View full output` `:360-368`; toggle guard `:286-295`; same markdown stack (`:35-…`). Console may not import `@/components/*` or `@/lib/api` (`console-isolation.test.ts:7-14, :67-72`).
- Tests that encode the current body: `NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx:969-1423` (disclosure rows, incl. `:1281` nested-toggle guard), `ConsoleNodeRoom.test.tsx:1168-1780` (incl. `:1481` nested-toggle guard), `ConsoleExecutionHistory.test.tsx` (second Console mount).
- Web test script runs `src/lib/`, `src/components/`, `src/experiments/console/` in separate `bun test` invocations (`packages/web/package.json:11`).

## Sibling work in flight

- Story 1.2 plan `plans/260918-1038-issue-175-raw-payload-toggle/` (pending, no PR) removes the Input/Output bridge and adds a Raw swap slot in the same two body regions; it kept the toggle guard *because* subtask cards were coming (its plan.md, "Verified repository facts", item 4). Its owner decision "Interim expanded body — accept bar-only" defines what a row with no family arm shows between 1.2 and 1.3.
- Story 1.3 (backlog) owns the `generic` body arm and the other family arms.

## Provider payload shapes

| Provider | Shape | Source |
| --- | --- | --- |
| OMP batch | `{ context?: string, tasks: [{ name, agent, task }] }` | contract `:220-224`; `.memlog.md:32` |
| Claude `Agent` | `{ description, prompt, subagent_type?, model? }` | contract `:220-224`; SPEC `:183` (pinned SDK `sdk-tools.d.ts`) |

Real providers never send both `tasks[]` and `description`/`prompt` in one payload; the normalizer still needs a documented precedence.

## E2E reality

`e2e/fixtures/workflows/e2e-hitl-run.yaml` runs on `provider: e2e-fake`; `packages/providers/src/e2e-fake/provider.ts:27-29` hard-codes the only emitted tool as `Read` with `{ path: 'HITL_TOOL_INPUT.txt' }`, and the scenario schema (`:45-53`) has no way to emit a task dispatch. A Playwright proof of this story would need a `@archon/providers` change, which is outside a web-only presentation slice. Component tests on both surfaces are the gate.

## Contrast coverage

`DESIGN.md:466-475` already measures node-approval on surface-elevated (6.5:1 / 6.8:1) and text-secondary on surface (5.8:1 / 8.4:1) and on surface-inset (6.3:1 / 8.9:1). There is **no** row for text-secondary on surface-elevated (the card excerpt) or text-primary on surface-elevated at 11.5px in the transcript block (the dock rows at `:473-475` measure 11.5px text-primary/secondary on surface-elevated: 14.1:1 / 16.7:1 and 5.3:1 / 7.9:1, which are the same token pairs). Phase 3 records those two pairs explicitly for the card.
