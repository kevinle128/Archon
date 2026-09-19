---
phase: 1
title: 'Decision gate and shared-core correctness'
status: in-progress
priority: P1
effort: 'Gate closed 2026-09-19; projection + grouping core remain'
dependencies: []
---

# Phase 1: decision gate and shared-core correctness

## Goal

Resolve the product/design conflicts, confirm the Git target, refresh the plan with the accepted public behavior, then make transcript projection occurrence-safe and implement the pure grouping contract with tests. No production edit starts before the gate closes.

## Inputs to re-read at the gate

- `plan.md` — Blocking decisions B1–B4 and acceptance criteria.
- `SPEC.md` CAP-6 and `epics.md` Story 1.7.
- `ARCHITECTURE-SPINE.md` AD-7 and AD-12.
- `EXPERIENCE.md` Information Architecture, Component Patterns, Occurrence grouping, and the “Do the chips filter or scroll?” decision.
- `DESIGN.md` occurrence-heading and 460px rules.
- Design handoff README plus Console/Legacy `.dc.html` and occurrence mockups.
- Current `agent-history.ts`, `project-text-transcript.ts`, `pair-tool-transcript.ts`, generated `WorkflowNodeMessage` type, and their tests.

## Gate A — record B1

The product/architecture owner must choose:

- **compatibility-only node-scoped grouping**, preserving exact occurrence selection; or
- a **first-class aggregate loop view**, with its entry, selection identity, retry/nesting/route boundaries, Ask ownership, authorization/visibility boundary, paging, default behavior, and performance contract.

Required outputs:

1. Update the owning canonical product/architecture/UX text; do not rely on this plan as durable authority.
2. Update `plan.md`'s behavior table, inventory, acceptance criteria, tests, performance budget, compatibility, and rollback.
3. If aggregate is accepted, scout every selection mapper and scope-key consumer, including `WorkflowExecution.tsx` and `RunDetailPage.tsx`; list exact files before editing.
4. If compatibility-only is accepted, state explicitly that current loop occurrence rows still show no headings/navigator and Story 2.10 remains blocked on a later reachability decision.

The former `loopParent` / `All iterations` design is not an accepted default.

**Recorded 2026-09-19: compatibility-only.** The decision lives in the `ARCHITECTURE-SPINE.md` AD-7 amendment (issue #180 decision B1) and `EXPERIENCE.md` Information Architecture; `plan.md` reflects it. Modern loop occurrence rows show no headings/navigator and Story 2.10 remains blocked on a future reachability decision. No aggregate selection mapper or scope-key consumer is scouted or edited.

## Gate B — record B2

The UX/product owner must approve an artifact covering:

- control type and relationship to `Execution`;
- exact copy, placement, sizes, and all visible states;
- pointer/keyboard activation and focus destination;
- live-poll/scroll-follow behavior and vanished target handling;
- 460px and host small-viewport behavior;
- accessibility name, heading relationship, and announcement behavior.

Required outputs:

1. Update `DESIGN.md` / `EXPERIENCE.md` or add a clearly adopted design artifact.
2. Replace Phase 2's conditional navigator steps with exact component locations and assertions.
3. Add exact visual states/viewports to Phase 3.

**Recorded 2026-09-19: second, separate `Jump to` select.** The contract lives in `EXPERIENCE.md` (Information Architecture; Component Patterns → Occurrence navigator; State Patterns → Navigator rows; Interaction Primitives; Accessibility Floor) and `DESIGN.md` Components → Occurrence navigator (delta 5). Phase 2's navigator section and Phase 3's matrix/a11y rows now carry the concrete contract.

## Gate C — confirm the working branch

`AGENTS.md` requires `dev`, while origin HEAD, the current worktree base, and active PRs use `develop`; local `dev` is 68 commits behind and is not tracked on origin. Obtain a maintainer decision before branch mutation or PR work, then correct the stale repository authority so future implementers do not have to rediscover the conflict.

**Recorded 2026-09-19: `develop`.** Evidence: `origin/HEAD` is `refs/remotes/origin/develop`; open PRs #202/#205 target `develop`; `origin/dev` is deleted and local `dev` is 68 commits behind. Corrections applied: `AGENTS.md` (working branch + release comparison), `e2e-smoke.yml` push trigger, `release.yml` checkout ref and formula push. Residual debt recorded in `plan.md`: `.claude/skills/release/SKILL.md` still encodes `dev`→`main` (also touched by open PR #202 — maintainer release-time fix).

## Gate D — make occurrence labels distinguishable

Product/UX must extend or constrain the canonical label rule for two distinct occurrence keys that derive the same base label. Cover at least:

- two route activations with the same `retry_epoch` and different `route_activation_seq`;
- nested loop scopes whose final ancestry entry has the same iteration number;
- collision plus retry/failure suffixes;
- navigator accessible names without exposing raw UUIDs.

Record the rule in the owning occurrence-grouping authority and add its exact examples to the Phase 1/2 tests before implementation.

**Recorded 2026-09-19: typed-field disambiguation.** The rule lives in `EXPERIENCE.md` Occurrence grouping: `route_activation_seq` → ` #N`; deeper `loop_ancestry` → iteration path `Iteration M › Iteration N` (then nearest differing ancestry `node_id`); residual ties → `· occurrence K` by first-appearance order. Reason suffixes trail the qualifier; navigator option text and accessible names equal the final label; no raw ids.

## Preflight after the gate

1. Check issue #180, sprint state, `git status`, branch/base, active worktrees, and open PRs.
2. PR #202 currently overlaps both renderer files. After B3 confirms the target and PR #202 resolves, refresh from that target; preserve its row anatomy and tests.
3. Re-run focused green baselines before adding red tests.
4. Confirm no production file is already dirty for unrelated user work.

**Recorded 2026-09-19:** issue #180 open (`status:processing`, milestone "Agent Node Room"); sprint-status `1-7` = `backlog`; `git status` clean on `archon/thread-499eb44c`; base `develop` confirmed; active worktrees surveyed; open PRs #202 (overlaps `NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`, `ConsoleNodeRoom.test.tsx`, `NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx`, `ConsoleExecutionHistory.test.tsx`, `console-isolation.test.ts`) and #205 noted; focused baselines green — lib 27 tests, Legacy renderers 96, Console 72, `bun run type-check` clean; no production file dirty.

## Tests first — text projection and history scope

### `project-text-transcript.test.ts`

- keyed deltas with the same `stream_id` / `message_id` / `block_id` and same occurrence+attempt still merge as today;
- the same provider identifiers in different occurrences do not merge;
- the same occurrence with a new attempt does not merge;
- anonymous adjacent deltas merge only while execution identity is unchanged;
- a metadata-less historical sequence preserves current behavior;
- inputs are not mutated.

### `agent-history.test.ts`

- assistant items carry their projected message execution;
- lifecycle items carry their message execution;
- paired tools carry call execution (call/result already share occurrence+attempt by correlation key);
- a standalone result carries result execution;
- old rows produce `execution: null` on every item variant;
- existing todo folding, interrupted folding, outcome, and presentation expectations remain unchanged except for the added required field.

## Implement projection/history changes

1. Derive `TranscriptExecution` from `NodeMessageRow`; do not hand-copy a parallel wire interface.
2. Add `execution: TranscriptExecution | null` to all `AgentHistoryItem` variants.
3. Source execution at the projection boundary. Do not carry raw metadata into renderers.
4. Extend only the correlation portion of `ProjectableTextMetadata` with occurrence/attempt ids. Incorporate both into keyed stream identity and anonymous-delta continuity.
5. Do not add UUID regexes: server/database response schemas already validate the shape.

## Tests first — occurrence groups

Create `occurrence-groups.test.ts` covering:

1. no keyed items → `prefixItems` contains all items, no groups, no headings;
2. one occurrence → one group but `showHeaders=false`; callers retain the flat path;
3. two occurrences → one unique group per key, ordered by first appearance;
4. retry epochs 0 and 1 → `Run 1`, `Run 2 · retry`;
5. failed retry lifecycle → canonical failed/retry suffix composition as confirmed by the adopted UX text;
6. loop ancestry uses the final entry → `Iteration N`, with no failed suffix;
7. B4's exact route/nested collision examples produce distinct approved labels without raw ids;
8. different attempts with the same occurrence remain one group;
9. metadata-less item after a group joins that preceding group;
10. metadata-less items before the first occurrence remain in `prefixItems`;
11. repeated non-contiguous occurrence rejoins its first group; every item appears exactly once and per-group items retain sequence order;
12. model text containing `Run 99` or `Iteration 99` never affects labels;
13. input arrays/items are not mutated.

## Implement `occurrence-groups.ts`

- One pass over history already ordered by transcript sequence.
- `Map<occurrence_id, mutable accumulator>` plus an ordered group array.
- Hold leading unkeyed items separately; after the first key, append unkeyed items to the current preceding group.
- Use only typed execution and lifecycle state.
- Return fresh arrays/objects and `showHeaders = groups.length >= 2`.
- No React, DOM, shell tokens, provider branches, parsing, or network behavior.

## Focused validation

```bash
(cd packages/web && bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts src/lib/occurrence-groups.test.ts)
(cd packages/web && bun run type-check)
```

## Exit criteria

- [ ] B1, B2, and B4 are approved in durable authority, B3 identifies the Git target, and the plan is updated.
- [ ] PR/base preflight is recorded.
- [ ] Text projection cannot cross occurrence or attempt boundaries.
- [ ] Every history variant exposes required typed execution/null.
- [ ] Grouping/labels/prefix/non-contiguous cases pass without input mutation.
- [ ] No fetch, selection, renderer, scroll, or product-copy change lands in this phase.

## Rollback

Revert the focused Web core/tests. No data, API, or generated artifact changes.
