---
title: 'Issue 180 navigate transcript occurrences and loop iterations'
description: 'Verified implementation plan for Story 1.7 / CAP-6: preserve occurrence identity through transcript projection, group multi-occurrence transcripts, and add an approved navigator on both node-room shells.'
status: blocked
priority: P1
effort: 'Decision gate plus 3 implementation phases; estimate after the blockers are resolved'
issue: 'https://github.com/kevinle128/Archon/issues/180'
branch: archon/thread-499eb44c
tags: [issue-180, agent-node-room, web, tdd, epic-1, frontend]
blockedBy:
  - 'Product/architecture decision: whether and how a current occurrence-scoped loop exposes an aggregate multi-occurrence transcript'
  - 'UX decision: occurrence navigator layout, relationship to Execution, and keyboard/focus behavior'
  - 'Product/UX decision: disambiguation when distinct route or nested-loop occurrences derive the same documented label'
  - 'Maintainer decision before PR: AGENTS.md names dev, while origin HEAD, the active base, CI, and open PRs use develop'
blocks: []
created: 2026-09-18
updated: 2026-09-19
mode: deep
tdd: true
---

# Issue 180: navigate transcript occurrences and loop iterations

## Goal and interpretation

When the **messages actually loaded in a node transcript** span more than one `occurrence_id`, an operator should be able to distinguish the occurrences without reading an undifferentiated stream:

- one labelled section per occurrence, keyed by `occurrence_id`, never `attempt_id`;
- `Run N` for retry-driven occurrences and `Iteration N` for loop ancestry;
- a navigator that moves directly to a matching section on both Legacy and Console;
- neither headings nor navigator when zero or one occurrence is displayed.

That is the literal Story 1.7 / CAP-6 contract. The broader product phrase “loop iterations” currently has an unresolved reachability problem: modern loop rows are occurrence-scoped, while the adopted read architecture intentionally fetches only the selected occurrence. This plan does not silently change that contract.

## Review conclusion

The original draft was not safe to implement. Its central `loopParent` / `All iterations` proposal contradicted the final architecture and UX documents, changed the meaning of an occurrence selection into a node-wide fetch, introduced unapproved copy and Ask state, and relied on selector interactions that no approved design artifact specifies. Those changes have been removed.

The repository does support a well-bounded shared core and header implementation. Production work remains blocked until B1/B2/B4 under [Blocking decisions](#blocking-decisions) are recorded in the owning product, architecture, and UX artifacts; B3 must be resolved before branch mutation or PR handoff.

## Evidence inspected

### Product and planning authority

- GitHub issue `#180` (open, `status:processing`) delegates acceptance to Story 1.7 and requires focused characterization evidence plus the owning sprint workflow's final `done` transition.
- `_bmad-output/specs/spec-agent-node-room/SPEC.md`, CAP-6: group displayed rows by `occurrence_id`; omit the feature for one occurrence; navigate between group headers.
- `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`, Story 1.7: the same three measurable acceptance cases on both rooms.
- `_bmad-output/specs/spec-agent-node-room/test-plan.md`: renderer coverage on `NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx`.
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`: Story 1.1 is `done`; Story 1.7 remains `backlog`. Status is workflow-owned and is not changed by planning.

### Architecture, UX, and design authority

- `ARCHITECTURE-SPINE.md` AD-7: `buildAgentHistory()` carries execution metadata on assistant/tool/lifecycle items; a separate pure `lib/occurrence-groups.ts` owns grouping and labels; occurrence entry remains server-filtered to one group **by design**; all three history call sites apply grouping.
- `ARCHITECTURE-SPINE.md` AD-12 item 7: both shells own equivalent navigator behavior, rendered from core occurrence groups.
- `EXPERIENCE.md` Information Architecture and Occurrence grouping: Execution controls filter; occurrence headers appear only for messages actually displayed; occurrence selection and loop-iteration chips display one occurrence and therefore no header; exact heading vocabulary and suffix rules.
- `DESIGN.md`: heading typography and geometry—10.5px mono, uppercase, `0.08em` tracking, `text-secondary`, `10px 0 5px` margin, and a 1px `border` rule to the right edge; 460px is the authoritative room width for visual verification; the transcript owns no breakpoint.
- `claude-design/design_handoff_node_room_transcript_steering/README.md`, the `.dc.html` files, and the co-located HTML mockups: they show occurrence headings and the existing filtering `Execution` select. They do **not** show or specify a separate occurrence-navigation control. The README says the canonical spec/design/experience files win.

### Runtime, Web, tests, and configuration

- `packages/workflows/src/dag-executor.ts` mints one outer occurrence for a `loop:` node and another occurrence for every iteration; every transcript row records the active scope.
- A read-only SQLite check of run `448373788ab9e98c1cfde4e871beb891`, node `ralph-loop-run`, confirmed 3,465 rows and seven occurrences: two non-contiguous outer lifecycle rows plus six contiguous iteration groups.
- `packages/server/src/routes/workflow-execution-history.ts` reconstructs and orders those executions; both `build-log-rows.ts` copies turn every occurrence-bearing execution into an `occurrence` selection.
- `resolve-graph-room-row.ts` prefers a `node` row but falls back to the last occurrence row when no node row exists; `chooseExecutionForNode()` similarly chooses an awaiting/running/latest execution.
- `node-message-pages.ts`, the API route, and `workflow-node-messages.ts` pass `occurrenceId` / `attemptId` to the database, which performs the exact metadata filter. Persisted and response rows are schema-validated; the browser does not need a second UUID parser.
- Execution scope also carries `route_activation_seq`, and nested loops carry the full `loop_ancestry`. The adopted occurrence-label table uses only `retry_epoch` or the final ancestry entry; distinct route/nested occurrences can therefore derive identical visible labels even though their keys differ.
- `agent-history.ts` currently drops `metadata.execution`. `pair-tool-transcript.ts` already includes occurrence and attempt in tool correlation. `project-text-transcript.ts` does not include execution identity in keyed text streams, so two occurrences reusing the same stream/message/block identifiers could merge before grouping.
- The three grouping consumers required by AD-7 are `NodeTranscriptPane` → `NodeRoom`, `ConsoleNodeRoom` → `ConsoleAgentHistoryList`, and `ConsoleExecutionHistory` → `ConsoleAgentHistoryList`.
- Console hides tool and lifecycle rows inside `ConsoleAgentHistoryList`; hidden rows, and tool rows whose attached Ask card remains visible, affect whether a group has renderable content.
- `selectVisibleNodeAskInteractions()` deliberately excludes occurrence-scoped Asks from a `node` selection; Console inline history assigns scoped Asks to exact occurrence rows. An aggregate B1 choice therefore needs an explicit Ask contract, not reuse-by-accident.
- Both rooms use `room-scroll-follow.ts`; append polling re-applies the follow state. Any approved in-transcript navigator must explicitly define how navigation interacts with follow, restored `scrollTop`, “Jump to latest”, and focus.
- Open PR `#202` targets `develop` and overlaps `NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`, and their tests. Implementation must refresh from `develop` after that PR is resolved and re-scout the final shapes.
- Branch policy is internally inconsistent: `AGENTS.md` names `dev`, but local `dev` is 68 commits behind `develop`, origin has no tracked `dev`, origin HEAD is `develop`, CI watches both, and current PRs target `develop`. A maintainer must choose the authoritative target before branch refresh or PR creation.
- Root scripts confirm package-isolated Bun tests and `bun run validate`; Playwright is a standalone `e2e/` package.

## Verified end-to-end behavior today

```text
executor
  mints execution scope per occurrence/attempt
  writes metadata.execution on each node-message row
      │
      ▼
workflow execution history
  produces one execution row per occurrence
      │
      ▼
Legacy / Console LogRow selection
  occurrence-bearing row -> { kind: 'occurrence', occurrenceId, attemptId }
  compatibility/fallback row -> { kind: 'node' }
      │
      ▼
node-message paging
  occurrence -> server/database exact filter -> normally one group
  node       -> unfiltered node transcript     -> may contain many groups
      │
      ▼
text/tool projectors -> buildAgentHistory -> shell renderer
```

| Entry/data shape                                                           | Loaded messages                    | Story 1.7 output under the adopted contract        |
| -------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| Current prompt/loop execution with an occurrence                           | One occurrence                     | No headings or navigator                           |
| Current loop opened from Graph when all rows are occurrence-scoped         | Latest/awaiting/running occurrence | No headings or navigator                           |
| Historical/fallback node row with scoped messages from several occurrences | Whole node                         | Group headings and navigator                       |
| Historical transcript with no execution metadata                           | Whole node, unkeyed                | Original flat transcript; no headings or navigator |

This table is why the grouping contract is implementable but current-loop navigation is not yet a reachable product flow.

## Blocking decisions

### B1 — Modern loop reachability

The final AD-7 and `EXPERIENCE.md` explicitly say occurrence entry remains scoped and that this is intended. Current runtime evidence shows that a modern loop exposes only occurrence rows, so the multi-occurrence view is not its default or an existing selectable state. Story 2.10 nevertheless speaks of a finished loop iteration “selected through Story 1.7.” Repository evidence does not reconcile those statements.

The product/architecture owner must choose and record one of these outcomes before production work:

1. **Compatibility-only scope:** Story 1.7 applies only when a node-scoped transcript already contains multiple occurrences. This preserves AD-7 and current network behavior, but it does not provide a navigator for modern loops and cannot be described as unblocking Story 2.10.
2. **First-class aggregate loop view:** add an explicit aggregate selection/view whose user-visible entry, retry boundary, nested-loop boundary, Ask ownership, authorization/visibility boundary, default-selection behavior, paging, and performance contract are defined. Update AD-7, `EXPERIENCE.md`, tests, and this plan before implementation.

The rejected draft alternative was to mark a top-level loop's outer **occurrence** row `loopParent`, silently fetch the whole node, call it `All iterations`, and slice retries on the client. It changes the selected row's scope without a first-class model, is not specified by the product artifacts, drains all node pages, and is unsafe to generalize to nested loops or route activations.

### B2 — Navigator design and interaction

The canonical spec requires navigation, but the final visual artifacts show only the existing `Execution` filter. `DESIGN.md` gives heading styling but no navigator anatomy or placement. `EXPERIENCE.md` says the existing chips/select filters and currently says nothing scrolls. It does not define whether navigation retains focus on the control, moves focus to the heading, updates on reader scroll, or how a native select commits keyboard choices.

UX/product must provide or approve a design artifact that fixes all of the following:

- whether this is a second control or a deliberate change to the existing `Execution` control;
- exact label, option copy, placement relative to the room header, todo strip, transcript scroller, and “Jump to latest”;
- occurrence-heading semantic level and whether a navigation target becomes programmatically focusable;
- absent, default, active, focus-visible, disabled/loading, and Console-filtered states;
- pointer and keyboard activation semantics, focus destination, and screen-reader announcement;
- live polling behavior after navigation and behavior when the target group disappears;
- appearance at the authoritative 460px room width and under the host room's small-viewport layout.

Do not infer these decisions from generic native-select behavior. The original draft's `keydown`/`change` heuristic (arrows browse, Enter/Space commits) is not an approved contract and is not consistent across native select implementations.

### B3 — Working branch and PR target

Repository instructions say feature work branches from and merges to `dev`; live Git state uses `develop`. The implementer must not guess between them. Before rebasing or opening a PR, a maintainer must confirm the target and correct the stale authority (branch guidance or repository configuration) so the plan, Git history, CI, and PR base agree. This does not block the read-only/core design review, but it blocks branch mutation and PR handoff.

### B4 — Duplicate occurrence labels

The documented composer maps retry epoch to `Run N` and the final loop-ancestry entry to `Iteration N`. That is sufficient for a simple retry or one top-level loop, but not for repeated route activations with the same retry epoch or nested-loop scopes whose final entry repeats. Distinct `occurrence_id` groups can then expose indistinguishable headings/options such as two `Run 1` values. Existing execution-row labels already understand `route_activation_seq` (`name #N`), but no authority defines how it composes in an occurrence heading.

Product/UX must define a unique, human-readable label rule for colliding derived labels, including route and nested-loop examples, or explicitly narrow the supported multi-occurrence view so collisions cannot enter it. Update the occurrence-label table and test fixtures before implementing labels; do not expose raw UUIDs or invent a suffix in code.

## Evidence-resolved technical decisions

These decisions can be implemented after B1/B2/B4 are closed without further product interpretation.

1. **Preserve typed scope on every history item.** Add a required `execution: TranscriptExecution | null` field to assistant, tool, and lifecycle variants. Source it from the projected message; for a tool card, use call then result. Tool pairing already prevents cross-occurrence/attempt pairing.
2. **Keep text projection occurrence-safe.** Extend `ProjectableTextMetadata` with the execution identity used only for correlation. Include occurrence and attempt in keyed stream identity, and reset anonymous delta accumulation when execution identity changes. The rendered text is unchanged; this prevents a later occurrence merging into the first before grouping.
3. **Group only by `occurrence_id`.** `attempt_id` may distinguish projector correlation but is never a group key or visible label.
4. **Preserve leading unscoped content honestly.** Metadata-less items after a keyed item attach to the nearest preceding keyed group. Metadata-less items before the first keyed item render once as an unheaded prefix; assigning them to the following occurrence would contradict “nearest preceding.” With fewer than two keyed occurrences, render the original flat item sequence.
5. **One group object per occurrence, ordered by first appearance.** A repeated non-contiguous key rejoins its original group so a heading/selector target is unique. Items remain in sequence order inside that group. This necessarily groups the outer loop's trailing lifecycle row with its opening row; the test must make that reordering explicit.
6. **Labels come only from typed execution and lifecycle state.** For non-colliding cases, last loop ancestry entry → `Iteration N` with no suffix. Otherwise treat an absent `retry_epoch` as zero and use `retry_epoch + 1` → `Run N`; add `· retry` when epoch is greater than zero and `· failed` only when that occurrence contains a `failed` lifecycle state. B4 owns collision disambiguation. No agent-authored text, `attempt_id`, raw UUID, or provider name enters the label.
7. **Headers use the approved visual contract.** Each rendered occurrence section is a semantic heading at the level approved in B2, with the exact core label, 10.5px mono uppercase text, `0.08em` tracking, `text-secondary`, `10px 0 5px` margin, and a 1px `border` rule filling the remaining width. The label itself must remain in the accessibility tree.
8. **All three history surfaces group.** Legacy Node Room, Console Node Room, and Console inline execution history render headings. Only the two node rooms receive the Story 1.7 navigator; inline execution history has no independent scroller to navigate.
9. **Console groups reflect rendered content.** A Console group is displayable when it contains an item allowed by `showToolCalls` / `showSystem`, or a hidden tool item whose attached Ask card remains visible. Headings and navigator options use the same displayable group list. Unanchored Ask/approval blocks remain after the transcript and do not create a group.
10. **No unapproved product copy or state.** Do not add `All iterations`, `awaiting input` heading suffixes, new Ask routing, or changes to the existing `Execution` labels unless B1/B2/B4 explicitly adopt them.
11. **No duplicated wire validation.** API/database schemas already validate execution UUIDs and numeric fields. The Web core consumes the generated type, degrades absent historical execution to `null`, and does not add regex-based UUID validation.

## Shared grouping contract

The exact names may adapt to the final merged code, but the render-neutral shape must express the leading-prefix case rather than mislabelling it:

```ts
type TranscriptExecution = NonNullable<NonNullable<NodeMessageRow['metadata']>['execution']>;

interface OccurrenceGroup {
  key: string;
  label: string;
  items: readonly AgentHistoryItem[];
  iteration: number | null;
  retryEpoch: number;
  failed: boolean;
}

interface OccurrenceGrouping {
  prefixItems: readonly AgentHistoryItem[];
  groups: readonly OccurrenceGroup[];
  showHeaders: boolean; // groups.length >= 2
}
```

`groupByOccurrence(items)` is pure, does not mutate its input, makes one pass over items already in transcript sequence order, and returns every item exactly once. The shells use the original flat `items` path when `showHeaders` is false so historical and single-occurrence rendering stays byte-for-byte equivalent apart from the new required internal field.

## Scope

### In scope after B1/B2/B4

- Execution identity propagation and occurrence-safe text projection.
- Pure grouping/label logic and focused tests.
- Occurrence headings on Legacy Node Room, Console Node Room, and Console inline execution history.
- Console visible-group parity with its existing filters and attached Ask behavior.
- The approved navigator on both node rooms, with identical behavioral assertions.
- Minimal canonical doc correction for the approved navigator, plus any B1 architecture change explicitly accepted.
- Focused component/integration evidence, visual evidence at required widths/states, and a real-path E2E only if B1 makes a current path reachable.

### Out of scope unless B1 explicitly expands it

- Backend/API/schema/migration/generated-type/provider changes.
- Changing `Execution` filtering, graph-entry selection, Ask ownership, retry semantics, or loop execution semantics.
- Client-side “all pages for all iterations” fetching, virtualization, scroll-spy, persisted navigator state, or Story 2.10's read-only steering dock.
- Chat cards, Run Stream, and non-room transcript surfaces.
- New design tokens or a shared JSX renderer across Legacy and Console.

## File inventory

### Verified common-core and heading work

| Path                                                                                       | Change                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `packages/web/src/lib/agent-history.ts`                                                    | Add `TranscriptExecution`; preserve required `execution` on every item variant                   |
| `packages/web/src/lib/agent-history.test.ts`                                               | Cover assistant/tool/lifecycle propagation, absent historical scope, and paired/standalone tools |
| `packages/web/src/lib/project-text-transcript.ts`                                          | Include execution identity in text correlation and anonymous-delta boundaries                    |
| `packages/web/src/lib/project-text-transcript.test.ts`                                     | Prove identical stream ids in different occurrences/attempts never merge                         |
| `packages/web/src/lib/occurrence-groups.ts`                                                | New pure grouping and label composer                                                             |
| `packages/web/src/lib/occurrence-groups.test.ts`                                           | Full grouping, label, order, prefix, immutability, and total-coverage table                      |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                       | Render Legacy flat or grouped history without rewriting row anatomy                              |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                                  | CAP-6 renderer and semantic/visual-class assertions                                              |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                            | Keep direct-render compatibility and add a grouped regression if still applicable after PR #202  |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                             | Compute grouping and, after B2, own Legacy navigation against its scroller                       |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`                        | Group wiring and approved navigator/follow behavior                                              |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`      | Render Console flat/grouped history and expose one renderability predicate                       |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                      | Compute displayable groups and, after B2, own Console navigation                                 |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Paired CAP-6, filter, attached-Ask, and approved navigation tests                                |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`      | Apply grouping/headings without a navigator                                                      |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Multi/single/filter cases and absence of a navigator                                             |
| `packages/web/src/experiments/console/console-isolation.test.ts`                           | Preserve Console isolation                                                                       |

Keep a tiny shell-specific heading function in each existing renderer unless the merged code demonstrates a real boundary; do not create four one-use component files by default.

### Conditional on the accepted decisions

- B1 aggregate view may require `build-log-rows.ts` in both shells, `execution-room-model.ts`, `node-message-pages.ts`, selection helpers/call sites (including `WorkflowExecution.tsx` and `RunDetailPage.tsx`), server/API work, and their tests. None is authorized by the current plan until the first-class contract is written.
- B2 determines whether selector components are separate files and whether `room-scroll-follow.ts` needs a navigation transition. Add exact files and tests to this inventory when the design artifact is approved.
- E2E fixture/spec paths depend on B1. A current loop fixture cannot prove a multi-group view under strict occurrence filtering.
- `EXPERIENCE.md` must distinguish the filtering `Execution` control from the approved occurrence navigator. Amend AD-7 only if B1 changes its adopted fetch contract.

## Implementation phases

| Phase                                                                                          | Depends on | Deliverable                                                                                         |
| ---------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| [1. Decision gate and shared-core correctness](./phase-01-start.md)                            | None       | B1/B2/B4 recorded; refreshed plan; execution-safe projection and pure grouping tests/implementation |
| [2. Grouped renderers and approved navigator](./phase-02-two-shell-headers-and-selector.md)    | Phase 1    | Headings on all three consumers; approved navigator on both rooms; Console filter/Ask parity        |
| [3. Integration, visual/a11y evidence, docs, and gates](./phase-03-end-to-end-and-doc-sync.md) | Phases 1–2 | Reachability-appropriate integration evidence, canonical doc sync, full validation, PR handoff      |

No production edit begins until B1, B2, and B4 are closed and this plan's conditional inventory and acceptance criteria are updated with those decisions.

## Acceptance criteria

### Product and data correctness

- [ ] A displayed transcript with at least two distinct `occurrence_id` values renders exactly one labelled section for each key; every history item and attached Ask card renders exactly once.
- [ ] A transcript with zero or one distinct occurrence preserves the current flat rendering and shows neither occurrence headings nor navigator.
- [ ] Grouping never reads `attempt_id` as a key or label; distinct attempts inside one occurrence remain one group.
- [ ] Text deltas/snapshots with identical provider stream identifiers but different occurrence or attempt identities remain separate history items.
- [ ] Leading metadata-less items stay unheaded; later metadata-less items attach to the nearest preceding group; an entirely unscoped historical transcript stays flat.
- [ ] Labels match the canonical vocabulary and contain no agent-authored text.
- [ ] Distinct rendered groups have labels/options that are distinguishable under the B4 rule, including accepted route-activation and nested-loop cases.
- [ ] Modern loop behavior matches the accepted B1 contract and has a real test for its public entry path; no claim is made that Story 2.10 is unblocked under compatibility-only scope.

### UI, interaction, and accessibility

- [ ] Legacy and Console render the same labels, group ordering, absent/single/multiple states, and approved navigation outcomes.
- [ ] Each occurrence label is an accessible heading at the B2-approved level; the DOM order and accessibility tree match visual order.
- [ ] Heading visuals match `DESIGN.md` at a 460px room width on both shells: 10.5px mono, uppercase, `0.08em`, `text-secondary`, `10px 0 5px`, 1px rule to the right edge, no horizontal overflow, and no transcript-specific breakpoint.
- [ ] At the host room's existing small-viewport layout, labels/rules remain within the room and the approved navigator remains operable without changing transcript row wrapping.
- [ ] B2's default, active, keyboard, pointer, focus-visible, live-poll, vanished-target, and screen-reader states have identical tests on both node rooms.
- [ ] Console `showToolCalls` / `showSystem` never leaves an empty heading or stale navigator option, and hiding a tool row does not hide its attached Ask card.
- [ ] Console inline execution history renders headings when warranted but no node-room navigator.

### Contracts, reliability, and operations

- [ ] Under compatibility-only B1, occurrence selection continues to send exact `occurrenceId`/`attemptId` filters and no selection helper/model is changed.
- [ ] Any aggregate B1 choice has explicit retry/nesting/route/Ask/paging/performance tests and an updated file inventory before code starts.
- [ ] Any aggregate API/selection cannot expose another run or node, broaden the installation's existing authorization policy, or log transcript/Ask payloads; its access checks and failure responses have focused tests.
- [ ] Existing pagination, abort-on-scope-change, error/retry, restored scroll, live follow, “Jump to latest”, todos, Ask placement, and execution filtering remain green.
- [ ] Common-core grouping is linear in displayed history size and adds no network requests; any aggregate view records page count and render timing on the 3,465-row local sample and meets an owner-approved budget.
- [ ] No database migration or rollout step is introduced unless B1 explicitly requires one. Normal rollout is the Web bundle; rollback is a focused revert with no data cleanup.
- [ ] No Console module imports from `@/components/`; no Web module imports `@archon/workflows`; no generated type is edited by hand.

## Test strategy

1. Write pure projection/grouping tests first.
2. Add identical named renderer assertions to Legacy and Console suites.
3. Exercise Console visibility and attached Ask cards separately.
4. Add approved navigation/follow tests only after B2 fixes the contract; do not encode browser-specific native-select guesses.
5. Use real-path Playwright for modern loops only if B1 makes that path real. If B1 is compatibility-only, any intercepted/seeded browser fixture must be labelled renderer-integration evidence, not server reachability evidence.
6. Run the narrow Web tests, package type-check, lint, Console isolation, relevant Playwright checks, then `bun run validate` before PR.

Planned commands after the decisions fix the exact spec files:

```bash
(cd packages/web && bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts src/lib/occurrence-groups.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/web && bun run type-check)
bun run lint --max-warnings 0
(cd e2e && bun run typecheck)
# Run the B1-specific Playwright command recorded in Phase 3.
bun run validate
```

Never run root `bun test`.

## Compatibility, rollout, and rollback

- Historical rows with missing `metadata.execution` remain supported and flat.
- No stored data is rewritten. Adding an internal `execution: null` field changes only the Web presentation model.
- The common-core path is provider-neutral and uses generated response types.
- A focused Web revert restores the current presentation. If B1 introduces a public/API contract, its separate compatibility and rollback plan must be added before implementation.
- The owning BMad workflow—not an ad hoc edit during planning—moves Story 1.7 to `done` after accepted behavior and gates pass.

## Risks and mitigations

| Risk                                                                            | Mitigation                                                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| PR #202 changes the same renderers/tests                                        | Refresh from `develop` after it resolves, re-run the scout, and adapt rather than overwriting its row anatomy                    |
| Projected text crosses occurrence boundaries before grouping                    | Scope text correlation by occurrence and attempt; pin with focused tests                                                         |
| Metadata-less leading rows are falsely labelled                                 | Keep an explicit unheaded prefix; do not attach them forward                                                                     |
| Non-contiguous occurrence rows reorder globally when collected into one section | Test the behavior explicitly; one unique anchor per occurrence takes precedence over global inter-group chronology               |
| Distinct route/nested scopes derive the same base label                         | Block on B4; update the canonical composer and test collisions rather than showing raw ids or guessing                           |
| Console filters produce empty groups or hide Ask cards                          | Share one item renderability predicate and count attached Ask content when deriving displayable groups                           |
| Navigator re-arms live follow or loses focus                                    | B2 must define the behavior; model it as an explicit scroll-follow transition rather than an event-suppression heuristic         |
| Aggregate loop view drains thousands of rows                                    | No aggregate implementation without an explicit B1 paging/performance contract and measurement against the verified large sample |

## Final nine-perspective review

1. **Product outcome:** grouping is clear; modern-loop reachability is honestly blocked instead of assumed.
2. **Architecture:** the common core follows AD-7/AD-12; no adopted decision is silently reversed.
3. **Contracts:** occurrence/attempt/filter semantics and generated wire types are preserved.
4. **Security/reliability/data integrity:** labels use validated metadata only; no scope broadening or persistence mutation is authorized.
5. **Performance/scalability:** common work is linear and request-neutral; aggregate cost is gated.
6. **Implementation completeness:** all three history consumers, projection, filters, Asks, scrolling, and overlapping PR risk are covered.
7. **Testing:** pure, paired renderer, filter, integration, visual, accessibility, and full repository gates map to criteria.
8. **Operations/compatibility/rollback:** historical null scope remains flat; rollout/rollback need no data step on the common path.
9. **Simplicity/maintainability:** one render-neutral grouper, two shell renderers, no speculative selection abstraction or one-use component proliferation.

## Unresolved questions

B1, B2, and B4 block production implementation; B3 blocks branch refresh and PR handoff. Their required decision fields are explicit above. Do not begin implementation, amend AD-7, or claim Story 2.10 is unblocked until B1/B2/B4 are resolved and this plan is updated; do not rebase/open the PR until B3 is resolved.
