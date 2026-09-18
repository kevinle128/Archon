# PRD — Navigate transcript occurrences and loop iterations (Issue #180 / Story 1.7 / CAP-6)

Source plan: `plan.md` + `phase-01-start.md`, `phase-02-two-shell-headers-and-selector.md`, `phase-03-end-to-end-and-doc-sync.md` in this directory. The plan is authoritative; this PRD distills it for fresh-context iterations. Issue: https://github.com/kevinle128/Archon/issues/180 (delegates acceptance to `_bmad-output` Story 1.7 / CAP-6).

## Overview

When the messages actually loaded in a node transcript span more than one `occurrence_id`, an operator must be able to distinguish the occurrences instead of reading an undifferentiated stream: one labelled section per `occurrence_id` (`Run N` for retry epochs, `Iteration N` for loop ancestry), plus an approved navigator that jumps to a matching section on both the Legacy Node Room and the Console Node Room. With zero or one displayed occurrence, neither headings nor navigator appear — rendering stays byte-for-byte flat.

## Problem

Today `buildAgentHistory()` drops `metadata.execution`, so the Web UI cannot tell which occurrence produced a row, and `project-text-transcript.ts` correlation keys do not include execution identity, so identical provider stream ids across occurrences can merge before grouping. Meanwhile a modern occurrence-scoped loop row is server-filtered to exactly one occurrence — multi-occurrence display is only reachable today via node-scoped (historical/fallback) transcripts. The plan therefore gates production work on four decisions (B1–B4, below) before any edit.

## Solution (as planned)

1. Preserve typed execution scope on every history item; make text projection occurrence-safe.
2. A new pure `packages/web/src/lib/occurrence-groups.ts` owns grouping + label composition (AD-7).
3. All three history consumers render occurrence headings: `NodeTranscriptPane`/`NodeRoom` (Legacy), `ConsoleNodeRoom`/`ConsoleAgentHistoryList`, and `ConsoleExecutionHistory` (headings only, no navigator).
4. Only the two node rooms get the Story 1.7 navigator (AD-12 item 7), per the B2-approved design contract.
5. Phase 3 proves the reachable path, captures visual/a11y evidence, syncs canonical docs, runs repo gates, and hands off the PR.

## Goals and success metrics

- A displayed transcript with ≥2 distinct `occurrence_id` values renders exactly one labelled section per key; every history item and attached Ask card renders exactly once.
- Zero/one-occurrence transcripts render the current flat path with no headings and no navigator.
- Labels use only typed execution + lifecycle state — never `attempt_id`, raw UUIDs, agent-authored text, or provider names.
- Legacy and Console render identical labels, ordering, absent/single/multiple states, and navigation outcomes.
- Heading visuals match `DESIGN.md` at 460px room width: 10.5px mono, uppercase, `0.08em` tracking, `text-secondary`, `10px 0 5px` margin, 1px `border` rule to the right edge, no horizontal overflow.
- Console `showToolCalls`/`showSystem` never leaves an empty heading or stale navigator option; hiding a tool row does not hide its attached Ask card.
- Grouping is linear in displayed history size, adds zero network requests, and does not mutate inputs.
- Existing contracts stay green: Execution select filtering, pagination/abort/partial states, todos, Ask placement, live follow, restored scroll, "Jump to latest", Console isolation.

## Blocking decisions (resolve in US-001 — headless: pick the evidence-supported option and RECORD it)

- **B1 — Modern loop reachability.** Default to **compatibility-only** node-scoped grouping (preserves AD-7's scoped fetch and current network behavior) unless the agent authors and records a complete first-class aggregate contract (entry point, selection identity, retry/nesting/route boundaries, Ask ownership, authorization/visibility boundary, paging, default selection, performance budget). The rejected `loopParent` / "All iterations" draft is never acceptable. Under compatibility-only, state explicitly that modern loop rows show no headings/navigator and Story 2.10 remains blocked.
- **B2 — Navigator design contract.** Author and record the design artifact (in `DESIGN.md`/`EXPERIENCE.md` or a clearly adopted doc): control type vs. the existing `Execution` filter, exact copy/placement/sizes, all visible states, pointer+keyboard activation and focus destination, live-poll/scroll-follow and vanished-target behavior, 460px and small-viewport layout, accessible name/heading relationship/announcements. Do NOT guess native-select key heuristics.
- **B3 — Branch/PR target.** Evidence in repo: `origin HEAD` and open PRs use `develop`, local `dev` is ~68 commits behind and untracked; `AGENTS.md` names `dev`. Resolve from git evidence (expected: `develop`), correct the stale authority so future implementers don't rediscover the conflict, and record the decision.
- **B4 — Duplicate occurrence labels.** Record a deterministic disambiguation rule for colliding derived labels (e.g. two `Run 1`s from repeated route activations or nested loops with equal final ancestry), covering route `route_activation_seq` and nested-ancestry cases, retry/failed suffix composition, and navigator accessible names — never raw UUIDs. Update the canonical occurrence-label table and test fixtures.

## Non-goals (out of scope unless B1 explicitly expands)

- Backend/API/schema/migration/generated-type/provider changes.
- Changing `Execution` filtering, graph-entry selection, Ask ownership, retry or loop execution semantics.
- Client-side "fetch all pages for all iterations", virtualization, scroll-spy, persisted navigator state, Story 2.10's steering dock.
- Chat cards, Run Stream, non-room transcript surfaces.
- New design tokens or a shared JSX renderer across Legacy and Console; no one-use component proliferation.
- Sprint-status mutation — the owning BMad workflow moves Story 1.7 to `done`, not the implementer.

## Technical context

### Runtime / data flow (verified in plan)

- `packages/workflows/src/dag-executor.ts` mints one outer occurrence per `loop:` node plus one per iteration; every node-message row records active scope in `metadata.execution` (occurrence_id, attempt_id, retry_epoch, route_activation_seq, loop_ancestry).
- `packages/server/src/routes/workflow-execution-history.ts` reconstructs executions; both `build-log-rows.ts` copies map occurrence-bearing rows to `{ kind: 'occurrence', occurrenceId, attemptId }` selections; `resolve-graph-room-row.ts` falls back to the last occurrence row.
- `packages/web/src/lib/node-message-pages.ts` + API pass `occurrenceId`/`attemptId` to the DB for exact filtering — the wire already validates UUIDs; no client-side regex validation.
- Verified real data: run `448373788ab9e98c1cfde4e871beb891`, node `ralph-loop-run` — 3,465 rows, 7 occurrences (non-contiguous outer lifecycle rows + 6 contiguous iteration groups).

### Files to change (verified inventory)

| Path                                                                                                 | Change                                                                              |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/web/src/lib/agent-history.ts`                                                              | Add `TranscriptExecution`; required `execution` on every `AgentHistoryItem` variant |
| `packages/web/src/lib/agent-history.test.ts`                                                         | Propagation + `execution: null` for historical rows                                 |
| `packages/web/src/lib/project-text-transcript.ts`                                                    | Execution identity in keyed stream correlation + anonymous-delta boundary           |
| `packages/web/src/lib/project-text-transcript.test.ts`                                               | Same stream ids across occurrences/attempts never merge                             |
| `packages/web/src/lib/occurrence-groups.ts`                                                          | NEW — pure grouping + label composer                                                |
| `packages/web/src/lib/occurrence-groups.test.ts`                                                     | NEW — full grouping/label/prefix/immutability table                                 |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                                       | Compute grouping; own Legacy navigation (post-B2)                                   |
| `packages/web/src/components/workflows/NodeRoom.tsx` (+`.test.tsx`)                                  | Flat or grouped render; CAP-6 assertions                                            |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                                      | Keep direct-mount compatibility                                                     |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`                | Flat/grouped render + one shared renderability predicate                            |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` (+`.test.tsx`)                 | Displayable groups + Console navigation (post-B2)                                   |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx` (+`.test.tsx`) | Headings only, no navigator                                                         |
| `packages/web/src/experiments/console/console-isolation.test.ts`                                     | Must stay green — no `@/components/` imports into Console                           |
| `packages/web/src/lib/room-scroll-follow.ts`                                                         | Only if B2 requires an explicit new transition                                      |

Shared grouping contract (plan.md "Shared grouping contract"): `OccurrenceGroup { key, label, items, iteration, retryEpoch, failed }`, `OccurrenceGrouping { prefixItems, groups, showHeaders /* groups.length >= 2 */ }`; `groupByOccurrence(items)` pure, one pass, input unmutated, every item returned exactly once; `TranscriptExecution` derived from `NodeMessageRow['metadata']['execution']` — never a hand-copied interface.

### Canonical authorities to read/update

- `_bmad-output/specs/spec-agent-node-room/SPEC.md` (CAP-6) and `test-plan.md`
- `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (Story 1.7)
- `ARCHITECTURE-SPINE.md` AD-7 (grouping ownership, scoped fetch) and AD-12 item 7 (both shells navigate)
- `EXPERIENCE.md` (Information Architecture, occurrence grouping, Execution = filter), `DESIGN.md` (heading typography, 460px authority)
- `claude-design/design_handoff_node_room_transcript_steering/` — mockups show headings but NOT a navigator; canonical specs win

### Known hazards

- Open PR #202 overlaps `NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx` and their tests — refresh from the B3-confirmed base and re-scout before renderer edits.
- Grouping never keys on `attempt_id`; metadata-less items before the first key stay in `prefixItems`, after a key join the nearest preceding group; a repeated non-contiguous key rejoins its original group (one unique anchor per occurrence).
- Console group displayability = has a renderable item OR a hidden tool item whose attached Ask card still renders.
- Never run root `bun test` — use the package-scoped commands below.

## Story overview

| #      | Story                                                    | Phase                     | Depends on |
| ------ | -------------------------------------------------------- | ------------------------- | ---------- |
| US-001 | Close decision gates B1–B4, refresh plan, preflight      | 1 (gates A–D + preflight) | —          |
| US-002 | Occurrence-safe projection + pure grouping core (TDD)    | 1 (impl)                  | US-001     |
| US-003 | Occurrence headings on all three history consumers       | 2 (renderers)             | US-002     |
| US-004 | B2-approved navigator on both node rooms + scroll-follow | 2 (navigator)             | US-003     |
| US-005 | Integration/visual/a11y evidence, doc sync, gates, PR    | 3                         | US-004     |

## Validation commands

```bash
(cd packages/web && bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts src/lib/occurrence-groups.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/web && bun run type-check)
bun run lint --max-warnings 0
(cd e2e && bun run typecheck)
# B1-specific Playwright command(s) recorded during US-001
bun run validate
```
