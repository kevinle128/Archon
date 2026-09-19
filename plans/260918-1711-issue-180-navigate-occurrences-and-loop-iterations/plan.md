---
title: 'Issue 180 navigate transcript occurrences and loop iterations'
description: 'Verified implementation plan for Story 1.7 / CAP-6: preserve occurrence identity through transcript projection, group multi-occurrence transcripts, and add an approved navigator on both node-room shells.'
status: in-progress
priority: P1
effort: 'Gate closed 2026-09-19; 3 implementation phases remain'
issue: 'https://github.com/kevinle128/Archon/issues/180'
branch: archon/thread-499eb44c
tags: [issue-180, agent-node-room, web, tdd, epic-1, frontend]
blockedBy: []
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

The repository does support a well-bounded shared core and header implementation. **The decision gate closed on 2026-09-19**: B1/B2/B4 are recorded in their owning canonical artifacts and B3's branch target is confirmed — see [Recorded decisions](#recorded-decisions). Production work proceeds against that contract; no open blockers remain.

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

This table is why the grouping contract is implementable but current-loop navigation is not a reachable product flow — and B1 (recorded below) adopts that reading as the contract rather than a gap to be closed in this feature.

## Recorded decisions

All four gate decisions were recorded on 2026-09-19 in their owning canonical artifacts. This section is the plan's index into them; the artifacts themselves are the durable authority.

### B1 — Modern loop reachability: **compatibility-only** (recorded)

Recorded in `ARCHITECTURE-SPINE.md` as a dated amendment on AD-7, with the reachability mechanics in `EXPERIENCE.md` Information Architecture. Story 1.7 applies only when a node-scoped transcript already contains multiple occurrences — the path AD-7 was written for. No first-class aggregate contract was authored (entry, selection identity, retry/nested-loop/route-activation boundaries, Ask ownership, authorization/visibility boundary, paging, default selection, and a performance budget would all have had to be specified), so the aggregate alternative is not authorized and no selection mapper or scope-key consumer — including `WorkflowExecution.tsx` and `RunDetailPage.tsx` — is scouted or touched.

Consequences, recorded explicitly:

- Current loop occurrence rows still show **no** headings and **no** navigator — an occurrence-scoped selection returns one group by design.
- Story 2.10's "finished iteration selected through Story 1.7" **remains blocked** on a future reachability decision; nothing here claims otherwise.
- The rejected `loopParent` / `All iterations` draft stays rejected.

### B2 — Navigator design: **second `Jump to` select** (recorded)

Recorded in `EXPERIENCE.md` (Information Architecture; Component Patterns → Occurrence navigator; State Patterns → Navigator rows; Interaction Primitives; Accessibility Floor) and `DESIGN.md` Components → Occurrence navigator (delta 5). The contract in brief:

- A second, separate native `<select>`; the `Execution` select stays a pure filter and is untouched.
- Copy: visible `<label>` `Jump to`; disabled placeholder option `N occurrences` with the real count; options are the rendered headings' labels verbatim in group order, valued by `occurrence_id`.
- Placement: one control row at the bottom edge of the room region, after the transcript scroller — `Jump to` at the left, `Jump to latest` at the right edge. Same on both shells.
- Headings are `h3`, programmatically focusable (`tabindex="-1"`), DOM id = `useId` + `occurrence_id`.
- Activation: `change` only, no custom key handlers. Commit scrolls the target to the top of the viewport (not at all if already fully visible) and moves DOM focus to the heading.
- Follow: one explicit `jumpToOccurrence` reducer transition to the manual-hold state; `Jump to latest` re-pins unchanged. No event-suppression heuristic.
- Vanished target: the select resets to the placeholder; a focused heading that unmounts moves focus to the select or the scroller, never `<body>`.
- Announcement: none on navigation — moved focus delivers the heading name; the polite `role="status"` stays scoped to node transitions/failures.
- States: absent below two displayable groups (never disabled/loading); default = placeholder; valued = last committed navigation; focus-visible = the shell ring.
- Layout: 460px authoritative; the select shares the `Execution` anatomy (`text-xs`, `surface-elevated`, `border`, `rounded.sm`, `10rem` max, end-elided) and clears the 24px SC 2.5.8 floor through padding; no transcript breakpoint — host small-viewport inherits the room.
- The select is an action, not a position indicator — no scroll-spy, no inferred cross-browser key heuristics.

### B3 — Working branch and PR target: **`develop`** (recorded)

Determined from Git evidence on 2026-09-19: `origin/HEAD` is `refs/remotes/origin/develop`; open PRs #202 and #205 both target `develop`; `origin/dev` is deleted and local `dev` (`6cb3f8e2`) is 68 commits behind `develop` (`83e46ebc`) and untracked. The stale authority is corrected so plan, CI, and PR base agree:

- `AGENTS.md` — working branch and `/release` comparison now say `develop`.
- `.github/workflows/e2e-smoke.yml` — push trigger `[main, dev]` → `[main, develop]` (CI now covers the real working branch).
- `.github/workflows/release.yml` — `ref: dev` → `ref: develop`; `git push origin dev` → `git push origin develop` (origin/dev no longer exists; pushing to it would recreate a stale branch).
- `.github/workflows/test.yml` — already watches `[main, dev, develop]`; unchanged.

Residual debt, recorded not silently left: `.claude/skills/release/SKILL.md` still encodes the `dev`→`main` flow in ~15 places (its own `origin/dev` ancestry check now fails loudly, so nothing breaks silently), and `docs-build.yml`'s comment references `dev`. The skill file is also touched by open PR #202 — flagged for a maintainer's release-time fix rather than colliding with that PR here.

### B4 — Duplicate occurrence labels: **typed-field disambiguation** (recorded)

Recorded in `EXPERIENCE.md` Occurrence grouping with concrete examples. Within a maximal set of groups deriving the same base label, each group takes the first qualifier that makes it unique:

1. Distinct `route_activation_seq` → ` #N` (the shipped execution-row suffix): `Run 1 #1` / `Run 1 #2`.
2. `loop_ancestry` deeper than one entry → iteration path root→leaf: `Iteration 1 › Iteration 3` / `Iteration 2 › Iteration 3`; if the path still ties, the nearest differing ancestry `node_id` is appended: `Iteration 1 › Iteration 3 · fetch_pages`.
3. Residual ties typed fields cannot separate → `· occurrence K` (first-appearance order): `Run 1` / `Run 1 · occurrence 2`.

Reason suffixes always trail the qualifier (`Run 1 #2 · retry`, `Run 2 · occurrence 2 · failed`). Navigator option text and accessible names are the identical final label; `occurrence_id`, `attempt_id`, and provider names never appear.

## Evidence-resolved technical decisions

These decisions are implementable now that B1/B2/B4 are recorded; none needs further product interpretation.

1. **Preserve typed scope on every history item.** Add a required `execution: TranscriptExecution | null` field to assistant, tool, and lifecycle variants. Source it from the projected message; for a tool card, use call then result. Tool pairing already prevents cross-occurrence/attempt pairing.
2. **Keep text projection occurrence-safe.** Extend `ProjectableTextMetadata` with the execution identity used only for correlation. Include occurrence and attempt in keyed stream identity, and reset anonymous delta accumulation when execution identity changes. The rendered text is unchanged; this prevents a later occurrence merging into the first before grouping.
3. **Group only by `occurrence_id`.** `attempt_id` may distinguish projector correlation but is never a group key or visible label.
4. **Preserve leading unscoped content honestly.** Metadata-less items after a keyed item attach to the nearest preceding keyed group. Metadata-less items before the first keyed item render once as an unheaded prefix; assigning them to the following occurrence would contradict “nearest preceding.” With fewer than two keyed occurrences, render the original flat item sequence.
5. **One group object per occurrence, ordered by first appearance.** A repeated non-contiguous key rejoins its original group so a heading/selector target is unique. Items remain in sequence order inside that group. This necessarily groups the outer loop's trailing lifecycle row with its opening row; the test must make that reordering explicit.
6. **Labels come only from typed execution and lifecycle state.** For non-colliding cases, last loop ancestry entry → `Iteration N` with no suffix. Otherwise treat an absent `retry_epoch` as zero and use `retry_epoch + 1` → `Run N`; add `· retry` when epoch is greater than zero and `· failed` only when that occurrence contains a `failed` lifecycle state. Collisions resolve through the recorded B4 qualifiers (` #N`, ancestry path, differing `node_id`, residual `· occurrence K`). No agent-authored text, `attempt_id`, raw UUID, or provider name enters the label.
7. **Headers use the approved visual contract.** Each rendered occurrence section is an `h3` heading — the level B2 recorded — carrying the exact core label, programmatically focusable (`tabindex="-1"`, id = `useId` + `occurrence_id`), with 10.5px mono uppercase text, `0.08em` tracking, `text-secondary`, `10px 0 5px` margin, and a 1px `border` rule filling the remaining width. The label itself must remain in the accessibility tree.
8. **All three history surfaces group.** Legacy Node Room, Console Node Room, and Console inline execution history render headings. Only the two node rooms receive the Story 1.7 navigator; inline execution history has no independent scroller to navigate.
9. **Console groups reflect rendered content.** A Console group is displayable when it contains an item allowed by `showToolCalls` / `showSystem`, or a hidden tool item whose attached Ask card remains visible. Headings and navigator options use the same displayable group list. Unanchored Ask/approval blocks remain after the transcript and do not create a group.
10. **No unapproved product copy or state.** Do not add `All iterations`, `awaiting input` heading suffixes, new Ask routing, or changes to the existing `Execution` labels — the recorded decisions adopt none of them.
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

### In scope

- Execution identity propagation and occurrence-safe text projection.
- Pure grouping/label logic and focused tests.
- Occurrence headings on Legacy Node Room, Console Node Room, and Console inline execution history.
- Console visible-group parity with its existing filters and attached Ask behavior.
- The recorded `Jump to` navigator on both node rooms, with identical behavioral assertions.
- One explicit `jumpToOccurrence` transition in `room-scroll-follow.ts` plus its test — the B2 contract's scroll-follow interaction.
- Canonical doc sync (already amended at the gate; verify against built behavior).
- Focused component/integration evidence, visual evidence at required widths/states, and an optional seeded/intercepted Playwright spec labelled renderer-integration evidence.

### Out of scope — B1 adopted compatibility-only, so none of this expands

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
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                             | Compute grouping; render `h3` headings; own the Legacy `Jump to` row, navigation, and focus      |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`                        | Group wiring and the recorded navigator/follow/focus contract                                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`      | Render Console flat/grouped history and expose one renderability predicate                       |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                      | Compute displayable groups; own the Console `Jump to` row, navigation, and focus                 |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Paired CAP-6, filter, attached-Ask, and recorded navigation tests                                |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`      | Apply grouping/headings without a navigator                                                      |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Multi/single/filter cases and absence of a navigator                                             |
| `packages/web/src/experiments/console/console-isolation.test.ts`                           | Preserve Console isolation                                                                       |
| `packages/web/src/lib/room-scroll-follow.ts`                                               | Add the explicit `jumpToOccurrence` transition → manual-hold state                               |
| `packages/web/src/lib/room-scroll-follow.test.ts`                                          | Cover the new transition's state shape                                                           |

Keep a tiny shell-specific heading function in each existing renderer unless the merged code demonstrates a real boundary; do not create four one-use component files by default. The navigator row likewise lives inside `NodeTranscriptPane.tsx` and `ConsoleNodeRoom.tsx` — B2 specifies placement and anatomy, not a new component file, and two one-use files would violate the proliferation rule.

### Decisions consumed by this inventory

- B1 adopted compatibility-only: `build-log-rows.ts`, `execution-room-model.ts`, `node-message-pages.ts`, selection helpers, `WorkflowExecution.tsx`, `RunDetailPage.tsx`, and all server/API files stay untouched — none is scouted for an aggregate that was not authorized.
- B2 adopted a second control: `NodeRoomHeader.tsx` and `ConsoleRoomHeader.tsx` are untouched; the `Execution` select keeps its filter role.
- E2E: no real-path aggregate fixture exists; the optional seeded spec is `e2e/ui/occurrence-navigation.spec.ts`, labelled renderer-integration evidence.
- Canonical docs (`EXPERIENCE.md`, `DESIGN.md`, `ARCHITECTURE-SPINE.md` AD-7) were amended at the gate; `AGENTS.md`, `e2e-smoke.yml`, and `release.yml` carry the B3 `develop` correction.

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
- [ ] Distinct rendered groups have labels/options that are distinguishable under the recorded B4 rule — ` #N` route suffixes, `Iteration M › Iteration N` ancestry paths, differing `node_id` qualifiers, and residual `· occurrence K`.
- [ ] Modern loop behavior matches the recorded compatibility-only contract: occurrence-scoped selection sends exact filters and yields one group with no headings/navigator, proven by the existing network assertions; no claim is made that Story 2.10 is unblocked.

### UI, interaction, and accessibility

- [ ] Legacy and Console render the same labels, group ordering, absent/single/multiple states, and identical navigation outcomes.
- [ ] Each occurrence label is an accessible `h3` heading; the DOM order and accessibility tree match visual order.
- [ ] Heading visuals match `DESIGN.md` at a 460px room width on both shells: 10.5px mono, uppercase, `0.08em`, `text-secondary`, `10px 0 5px`, 1px rule to the right edge, no horizontal overflow, and no transcript-specific breakpoint.
- [ ] At the host room's existing small-viewport layout, labels/rules remain within the room and the `Jump to` select remains operable with end-elision, without changing transcript row wrapping.
- [ ] The recorded navigator states — absent below two displayable groups, `N occurrences` placeholder at rest, valued after commit, focus-visible shell ring, manual-hold under live poll, placeholder reset on vanished target, focus to heading on commit, no live-region announcement — have identical tests on both node rooms.
- [ ] Console `showToolCalls` / `showSystem` never leaves an empty heading or stale navigator option, and hiding a tool row does not hide its attached Ask card.
- [ ] Console inline execution history renders headings when warranted but no node-room navigator.

### Contracts, reliability, and operations

- [ ] Occurrence selection continues to send exact `occurrenceId`/`attemptId` filters; no selection helper, scope-key consumer, or `Execution` control behavior is changed (compatibility-only B1 — no aggregate model exists to test).
- [ ] ~~Aggregate retry/nesting/route/Ask/paging/performance tests~~ — not applicable: the aggregate alternative was not authorized.
- [ ] ~~Aggregate API/selection isolation, authorization, and logging tests~~ — not applicable: no aggregate surface exists.
- [ ] Existing pagination, abort-on-scope-change, error/retry, restored scroll, live follow, “Jump to latest”, todos, Ask placement, and execution filtering remain green.
- [ ] Common-core grouping is linear in displayed history size and adds no network requests; the navigator adds no requests either. No aggregate exists, so no page-count/render-timing budget applies.
- [ ] No database migration or rollout step is introduced — B1 added none. Normal rollout is the Web bundle; rollback is a focused revert with no data cleanup.
- [ ] No Console module imports from `@/components/`; no Web module imports `@archon/workflows`; no generated type is edited by hand.

## Test strategy

1. Write pure projection/grouping tests first — including the recorded B4 examples (`Run 1 #1`/`Run 1 #2`, `Iteration 1 › Iteration 3`/`Iteration 2 › Iteration 3`, `· occurrence K` residual).
2. Add identical named renderer assertions to Legacy and Console suites.
3. Exercise Console visibility and attached Ask cards separately.
4. Add the recorded navigation/follow/focus tests — commit-on-change only, explicit `jumpToOccurrence` reducer transition, no browser-specific native-select guesses.
5. B1 is compatibility-only: no real-path modern-loop E2E exists. Any intercepted/seeded browser fixture (`e2e/ui/occurrence-navigation.spec.ts`) is labelled renderer-integration evidence, not server reachability evidence.
6. Run the narrow Web tests, package type-check, lint, Console isolation, relevant Playwright checks, then `bun run validate` before PR.

Commands:

```bash
(cd packages/web && bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts src/lib/occurrence-groups.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/web && bun test src/lib/room-scroll-follow.test.ts)
(cd packages/web && bun run type-check)
bun run lint --max-warnings 0
(cd e2e && bun run typecheck)
# Optional renderer-integration spec if written:
# (cd e2e && bun run test:ui -- occurrence-navigation.spec.ts)
bun run validate
```

Never run root `bun test`.

## Compatibility, rollout, and rollback

- Historical rows with missing `metadata.execution` remain supported and flat.
- No stored data is rewritten. Adding an internal `execution: null` field changes only the Web presentation model.
- The common-core path is provider-neutral and uses generated response types.
- B1 adopted compatibility-only: occurrence selection, request scope, and every selection helper/scope-key consumer are byte-for-byte unchanged — the compatibility surface is exactly today's.
- A focused Web revert restores the current presentation; no public/API contract exists, so no separate rollback plan is needed.
- The owning BMad workflow—not an ad hoc edit during planning—moves Story 1.7 to `done` after accepted behavior and gates pass.

## Performance budget

- Grouping is one O(n) pass over displayed items plus O(1) Map work per item; label composition is O(ancestry depth). No memoization is added at this scale per AD-8 — revisit only if a node's row count reaches the low hundreds while live-streaming.
- The navigator adds **zero** network requests: it scrolls within already-loaded messages and issues no fetch. Verified bound: the 3,465-row / seven-occurrence local sample is the stress reference; grouping it is a single pass with seven map entries.
- No aggregate view exists, so no paging/perf budget applies to one.

## Risks and mitigations

| Risk                                                                            | Mitigation                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| PR #202 changes the same renderers/tests                                        | Refresh from `develop` after it resolves, re-run the scout, and adapt rather than overwriting its row anatomy                  |
| Projected text crosses occurrence boundaries before grouping                    | Scope text correlation by occurrence and attempt; pin with focused tests                                                       |
| Metadata-less leading rows are falsely labelled                                 | Keep an explicit unheaded prefix; do not attach them forward                                                                   |
| Non-contiguous occurrence rows reorder globally when collected into one section | Test the behavior explicitly; one unique anchor per occurrence takes precedence over global inter-group chronology             |
| Distinct route/nested scopes derive the same base label                         | Resolved by the recorded B4 qualifiers; tests encode the canonical examples rather than showing raw ids or guessing            |
| Console filters produce empty groups or hide Ask cards                          | Share one item renderability predicate and count attached Ask content when deriving displayable groups                         |
| Navigator re-arms live follow or loses focus                                    | Resolved by the recorded contract: explicit `jumpToOccurrence` transition to manual hold; deliberate focus move to the heading |
| Aggregate loop view drains thousands of rows                                    | Not applicable — B1 did not authorize an aggregate view; nothing fetches beyond the selected scope                             |

## Final nine-perspective review

1. **Product outcome:** grouping is clear; modern-loop reachability is honestly recorded as out of scope rather than assumed.
2. **Architecture:** the common core follows AD-7/AD-12; the B1 amendment records compatibility-only on AD-7 itself.
3. **Contracts:** occurrence/attempt/filter semantics and generated wire types are preserved.
4. **Security/reliability/data integrity:** labels use validated metadata only; no scope broadening or persistence mutation is authorized.
5. **Performance/scalability:** common work is linear and request-neutral; the navigator adds zero requests.
6. **Implementation completeness:** all three history consumers, projection, filters, Asks, scrolling, and overlapping PR risk are covered.
7. **Testing:** pure, paired renderer, filter, integration, visual, accessibility, and full repository gates map to criteria.
8. **Operations/compatibility/rollback:** historical null scope remains flat; rollout/rollback need no data step on the common path.
9. **Simplicity/maintainability:** one render-neutral grouper, two shell renderers, no speculative selection abstraction or one-use component proliferation.

## Unresolved questions

None blocking implementation — all four gate decisions are recorded above and in their canonical homes. The one open product thread is Story 2.10's reachability ("finished iteration selected through Story 1.7"), which B1 explicitly leaves for a future decision; it must not be silently claimed as unblocked here.

## Preflight record (2026-09-19)

- **Issue/sprint:** #180 open, `status:processing`, milestone "Agent Node Room"; sprint-status `1-7-navigate-transcript-occurrences-and-loop-iterations` = `backlog` (workflow-owned, unchanged).
- **Git:** `git status` clean; branch `archon/thread-499eb44c` on the run's checkpoint base; `origin/HEAD` = `develop`; `dev` local-only, 68 behind, `origin/dev` deleted. Active worktrees surveyed (`git worktree list` — many `archon/thread-*` siblings, none colliding).
- **Open PRs:** #202 (`archon/thread-c192ed5c` → `develop`, overlaps `NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`, `NodeRoom.test.tsx`, `ConsoleNodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx`, `ConsoleExecutionHistory.test.tsx`, `console-isolation.test.ts`, plus `tool-presentation.*`, `tool-output.*`, e2e visual specs, and `.claude/skills/release/SKILL.md`); #205 (`archon/thread-0004f889` → `develop`, verification feature — no overlap). Implementation re-scouts the post-#202 shapes before editing.
- **Baselines (re-run green this iteration):** `bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts` → 27 pass; `NODE_ENV=development bun test` on the three Legacy renderer suites → 96 pass; on the three Console suites → 72 pass; `bun run type-check` → clean. (`occurrence-groups.test.ts` does not exist yet — it is Phase 1 implementation output.)
- **Unrelated changes:** none — the worktree was clean at iteration start; no production file carries user work.
