---
title: 'Issue 174 readable tool call row'
description: 'Implementation-ready plan for Story 1.1 readable tool-call rows in Legacy and Console.'
status: pending
priority: P1
effort: '3 phases'
tags: [issue-174, agent-node-room, web, tdd]
created: 2026-09-17
issue: 'https://github.com/kevinle128/Archon/issues/174'
---

# Issue 174 readable tool call row

## Goal and user outcome

Story 1.1 replaces each serialized tool card in the Legacy and Console agent-node transcripts with one compact disclosure row. An operator must be able to scan what ran, its target, its outcome, and its most important facts without opening JSON. The same stored call must mean the same thing on both surfaces, including historical runs; exact diagnostic input/output remains available behind closed temporary disclosures until Story 1.2 provides the final Raw control.

This is the actual project need documented in Epic 1 and issue #174. It is a presentation-only slice: it does not implement the later family bodies, diff, todo, task, Raw, occurrence, or steering stories.

## Evidence and authority

When sources differ, use them in this order:

1. `_bmad-output/specs/spec-agent-node-room/SPEC.md` and the Story 1.1 acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.
2. `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md` and `test-plan.md`.
3. Final `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` and `EXPERIENCE.md`.
4. `claude-design/design_handoff_node_room_transcript_steering/README.md` and the final HTML mockups: `key-transcript-states.html`, `key-console-node-room.html`, `key-legacy-node-room.html`, and `full-transcript-review.html`.
5. Current product code and tests for compatibility behavior not replaced by the story.

Verified repository facts:

- `projectToolTranscript()` already pairs calls/results and preserves input, output, exit code, message identity, occurrence, and attempt metadata.
- `buildAgentHistory()` is the shared projection seam. Its three production consumers are `NodeTranscriptPane.tsx`, `ConsoleNodeRoom.tsx`, and `ConsoleExecutionHistory.tsx`; the latter two use `ConsoleAgentHistoryList.tsx`.
- `buildAgentHistory()` currently derives outcome and output state but drops the exit code and emits every status row separately.
- Persisted `tool_called` events already provide tool ID and `created_at`; all three live transcript callers already refresh and compute a render-time clock, so the designed running elapsed badge requires only deterministic frontend plumbing.
- Both current renderers use filled `.ptool` cards and expose Input and Output JSON in open nested disclosures.
- The server parses persisted node-message JSON through Zod before it reaches the Web presenter; corrupt rows follow the existing API error path, while `input` and `output` may be any schema-valid JSON value.
- Three E2E cases assert the obsolete visible-output behavior: two in `workflow-run-hitl.spec.ts` and `[V:hitl.agent-history]` in `workflow-run-hitl-room.spec.ts`. The older visual spec also has a `.ptool` readiness locator that can match hidden descendant text.
- CI's HITL job selects uppercase `HITL` titles; `bun run validate` does not run Playwright.
- GitHub PR #194 attempted this story and was closed unmerged. It is review evidence only, not an implementation source or a reason to cherry-pick its unrelated changes.
- Issue #174 still says `status:processing`, but the run named in its latest comment is completed. No matching active alternate plan path was found in this checkout or at the path claimed by the draft. Recheck ownership at implementation time because labels and comments can change.

## Resolved source conflicts

- Story 1.1 explicitly says no collapsed row contains serialized-data punctuation. The presentation contract's generic-body notation `{…}` / `[n]` and the mockup place those markers in an expanded body, not the collapsed summary. Therefore object/array markers are deferred with Story 1.3; a generic collapsed headline uses up to three scalar facts, or the safe tool label when none exists.
- The final design documents override mockup-only values: verify at 460 px, not the Console mock's 520 px; use a 24 px minimum target, not the stale 22 px value.
- The final mockups show later Raw and family-body stories. Story 1.1 visual comparison is limited to row anatomy, default disclosure state, the minimal body bar, and surface behavior. The temporary closed Input/Output bridge is an intentional, documented difference.
- Direct result metadata remains the normal outcome source, but an immediately adjacent lifecycle row whose state is exactly `interrupted` is the final projection override required by the story. It must turn even a previously failed-looking call into `interrupted` and be consumed.
- The final accessibility design includes a future shared announcement channel for transcript and steering transitions. Story 1.1 references NFR1–3 and UX-DR1–2, while the serialized live-region contract is allocated to later NFR8 steering stories. This plan implements static names, keyboard behavior, focus, and native disclosure semantics but does not introduce a partial competing live-region system.

## Scope

### In scope

- One React-free, bounded, deterministic tool-row presentation policy in `packages/web/src/lib`.
- Exact nine-family resolution and Story 1.1 headline/chip/badge decisions.
- Exit-code propagation and immediate adjacent-interruption folding in shared history projection.
- Native disclosure rows in Legacy and Console, with equivalent semantics and surface-specific tokens/focus offsets.
- Stable operator-controlled disclosure state across polling, including untouched running-to-failed auto-open.
- Temporary closed diagnostic disclosures preserving current full-output loading and retry behavior.
- Unit, component, E2E, geometry, visual, keyboard, reduced-motion, and manual screen-reader evidence.

### Out of scope

- Stories 1.2–1.7: final Raw UI, family-specific bodies, diff rendering, todo folding, task cards, production-corpus gate, and occurrence navigation.
- Operator transcript rows, steering controls/announcements, Chat tool cards, Run Stream `ToolCallItem`, and provider execution behavior.
- Backend, API, persistence, database, schema, migration, generated types, provider, workflow-engine, or dependency changes.
- A shared React component, new design tokens, or a new styling system.

## End-to-end design

```text
schema-parsed node messages + workflow events
                  |
          pair-tool-transcript
                  |
  buildAgentHistory: outcome/runtime/output state/exit code
        + adjacent interrupted-row fold
                  |
     pure ToolRowPresentation on each tool item
             /                 \
 Legacy NodeRoom shell    Console history shell
             \                 /
     native details + identical semantics
```

The presenter owns classification, label, headline, status, initial-open policy, and ordered typed badges. Renderers own only DOM, elision markup, disclosure state, diagnostic controls, and surface tokens. Keep `buildAgentHistory()` returning `AgentHistoryItem[]`; widening it is needed only by later node-level todo state.

## Acceptance criteria

### Behavior and contracts

- [ ] Every paired tool call produces exactly one row in Legacy, Console selected-room history, and Console inline execution history; ordering, paging, extension slots, IDs, and full-output identity are unchanged.
- [ ] Summary order is chevron, status glyph, family chip, salient headline, and non-wrapping right badges.
- [ ] Initial state is table-driven: succeeded closed, failed open, running closed, interrupted closed, unknown closed.
- [ ] An untouched running/unknown row that becomes failed opens; once the operator toggles a row by pointer or keyboard, later updates never override that choice or auto-close it.
- [ ] Stable row identity is keyed by the existing tool item ID, so a poll update does not remount and lose local state.
- [ ] Status is conveyed by `✓` succeeded, `✕` failed, `◐` running, `⚠` interrupted, and `–` unknown, plus visually hidden words.
- [ ] State-pattern badges match the final design: running shows `running · <elapsed>` without premature `output missing`; interrupted shows `interrupted`; unknown shows `output unknown`; a row with no fact shows the alignment placeholder `—`. Running elapsed uses the exact persisted `tool_called.created_at`, a caller-supplied clock, and existing live rerenders—no new timer.
- [ ] The chip uses the exact sent name only when it is one whitespace-free token of at most 24 Unicode code points; otherwise it uses the family. MCP names display the contract's compact `server · tool` label.
- [ ] A collapsed summary has no JSON dump, quoted-key/object/array syntax produced by serialization, or visible Input/Output label. The presenter never synthesizes generic `{…}`/`[n]` markers there; legitimate command/code/pattern characters remain unchanged.
- [ ] An immediately following status row with exact state `interrupted` is consumed and overrides the preceding tool outcome; no fold crosses assistant text, another lifecycle row, or another tool.
- [ ] Exit code, duration, bounded count/language facts, and current output-state markers use one typed badge policy. Duration is the first badge hidden under pressure; every hidden summary fact remains readable in the opened minimal body bar.
- [ ] No collapsed badge loads full output. Count extraction accepts only explicitly bounded, deterministic scalar or shallow structured values; unsupported output shapes omit the count instead of guessing from prose.
- [ ] After the operator loads available full output, the same shared presenter refreshes the local row with `outputState: full`; a stale `truncated` badge disappears without resetting disclosure state.

### Safety, performance, and compatibility

- [ ] Exact normalized aliases win before structural inference; substring matching is forbidden (`search_replace` is file, never search).
- [ ] Known keys are direct lookups. Generic own-property scanning, fact count, string/source length, headline length, wrapper stripping, and optional JSON count parsing each have named caps and boundary tests.
- [ ] Nulls, arrays, deeply nested values, very wide objects, long strings, and unknown metadata cannot throw or trigger unbounded traversal. The public presenter catches an unexpected failure and returns a safe generic row.
- [ ] React text nodes remain the only rendering path for stored strings; no HTML injection or sanitizer is added.
- [ ] Corrupt persisted rows retain the existing server/API failure contract and are not silently repaired in the UI.
- [ ] Historical rows improve immediately. No data migration, feature flag, staged rollout, or API compatibility layer is required.

### Visual, responsive, and accessible behavior

- [ ] The resting row is on the room surface with no old filled/bordered card; hover alone uses `surface-hover`. Open content uses the specified 2 px left rail, 29 px indent, and 10 px left padding.
- [ ] Transcript padding is 10 px vertical/12 px horizontal and adjacent collapsed tool rows have no inherited 12 px card gap; assistant, lifecycle, and extension content retain deliberate per-item separation.
- [ ] Row typography is 12 px mono; chip/badges are 11 px; summary padding is 4 px vertical/6 px horizontal, gap 8 px, radius 6 px, and height at least 24 px.
- [ ] Chevron and glyph occupy fixed 9 px and 12 px columns. Chevron rotates 90° over 120 ms and has no transition under `prefers-reduced-motion`.
- [ ] The family chip has 1 px token-derived border, 1 px/7 px padding, 4 px radius, `surface-elevated`, and a 24ch ceiling. Search/glob text uses the final documented `color-mix`; nonzero exit digits use a measured token-derived mix clearing 4.5:1.
- [ ] Family hues follow the design table: shell/code bash, file/web command, search/glob prompt, todo/task approval, generic secondary. Status colors supplement, never replace, glyphs.
- [ ] At 460 px the summary remains one line. File/glob/URL headlines preserve their final segment with shrinkable head and fixed tail; other headlines end-elide; badges do not wrap and duration drops first.
- [ ] The existing 1440/1024/768/390 viewport sweep and 200% zoom remain usable without a transcript-specific breakpoint; whenever the room is visible, its tool summary stays one line and no critical fact is lost.
- [ ] Focus is a 2 px `--accent-bright` outline with offset −2 px Legacy and +2 px Console.
- [ ] The accessible-name order is state → tool/family → target → facts. Chevron and visible glyph are `aria-hidden`; the status word is visually hidden; the chip exposes `family · displayed-label` by accessible label/title (family only when identical, never a rejected overlong sent name); the opened body bar starts with the family word.
- [ ] Native summary behavior supplies click/tap, Enter, and Space. Tab moves row-to-row; arrow keys do nothing custom.
- [ ] Temporary nested Input/Output summaries are closed by default, use text-secondary, have a 24 px target and visible accent focus, and remain keyboard operable until Story 1.2 replaces them.
- [ ] Native expanded-state announcement is manually verified on at least one Windows/browser/screen-reader pairing and one macOS/browser/screen-reader pairing before completion, with the combinations and result recorded.
- [ ] Manual visual comparison reports only Story 1.1-owned properties. Later Raw/family bodies, diff/count richness, todo/task treatment, and occurrence controls are listed as expected differences, not false failures.

## Phases

| #   | Phase                                                                              | Depends on | Output                                                                           |
| --- | ---------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| 1   | [Shared presentation and history projection](./phase-01-start.md)                  | None       | Pure row model, bounded resolver, exit code, interruption fold, red E2E contract |
| 2   | [Legacy and Console renderers](./phase-02-two-surface-renderers.md)                | Phase 1    | Equivalent native disclosure shells and green component/E2E behavior             |
| 3   | [End-to-end and visual verification](./phase-03-end-to-end-visual-verification.md) | Phases 1–2 | Responsive/a11y evidence and full validation                                     |

## Global file inventory

| Path                                                                                       | Action                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `packages/web/src/lib/tool-presentation.ts`                                                | Create                                                                    |
| `packages/web/src/lib/tool-presentation.test.ts`                                           | Create                                                                    |
| `packages/web/src/lib/agent-history.ts`                                                    | Modify                                                                    |
| `packages/web/src/lib/agent-history.test.ts`                                               | Modify                                                                    |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                             | Modify: pass one render-clock snapshot into history projection            |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                       | Modify                                                                    |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                                  | Modify                                                                    |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                            | Modify                                                                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`      | Modify                                                                    |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                      | Modify: pass its existing render-clock snapshot into history projection   |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Modify                                                                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`      | Modify: pass its existing render-clock snapshot into history projection   |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Modify/verify indirect consumer                                           |
| `packages/web/src/experiments/console/console-isolation.test.ts`                           | Verify; modify only if a shared-lib allowlist entry is genuinely required |
| `e2e/ui/workflow-run-hitl.spec.ts`                                                         | Modify two stale cases                                                    |
| `e2e/ui/workflow-run-hitl-room.spec.ts`                                                    | Modify one stale case                                                     |
| `e2e/ui/workflow-run-hitl-visual.spec.ts`                                                  | Modify readiness locator only                                             |
| `e2e/ui/agent-tool-row-visual.spec.ts`                                                     | Create                                                                    |
| `plans/260917-1011-issue-174-readable-tool-call-row/reports/visual-acceptance.md`          | Create during implementation                                              |

`pair-tool-transcript.ts`, server routes/schemas, generated API types, and theme token files are read-only dependencies unless a failing requirement proves this inventory wrong. Stop and revise the plan before expanding into those areas.

## Implementation preflight and order

1. Recheck issue #174, open PRs, active runs, `git status`, and active worktrees. PR #194 is closed/unmerged and must not be treated as active ownership; coordinate only if new evidence shows an active owner.
2. Phase 1: change the three stale outside-in E2E expectations to the desired collapsed-row contract, add unit/history red tests, then implement pure presentation and projection.
3. Phase 2: add equivalent renderer red tests, implement Legacy, implement Console, then remove superseded context projection only after both consumers move.
4. Phase 3: fix the old visual readiness locator, add deterministic 460 px/focus/motion evidence, perform scoped visual and screen-reader reviews, and run all gates.

## Validation and proof

- Focused Web unit/component tests prove deterministic presentation, projection, disclosure transitions, diagnostics, and both Console mounts.
- The three updated HITL behavior cases prove one real stored success call in Console and Legacy.
- Component tests cover failed, interrupted, unknown, adversarial, and transition states that the fake provider does not emit.
- Geometry/computed-style assertions prove stable measurements; screenshots support human comparison and are attached through Playwright outputs rather than committed to an old plan directory.
- Run Web tests and type-check, E2E type-check, the relevant Playwright specs, then `bun run validate`. Never run root `bun test`.

## Rollout, failure handling, and rollback

- No migration or deployment ordering exists; this is a reversible Web-only presentation change over existing data.
- If a payload cannot be classified safely, fail closed to the generic row. If full-output loading fails, retain the existing inline retry path behind the opened diagnostics.
- If visual or accessibility acceptance fails, do not ship a partial alternate shell; fix the shared model or both renderers together.
- Roll back the complete feature change (presenter, history projection, both shells, and their updated tests) as one unit. Do not restore obsolete visible-JSON behavior as the desired contract in a forward implementation branch.

## Definition of done

- [ ] Every acceptance criterion above has passing automated evidence or a named manual record.
- [ ] All three stale HITL behavior tests express and pass the new contract; the old visual locator cannot pass on hidden output.
- [ ] Both Console mounts and Legacy pass equivalent row/state tests.
- [ ] `reports/visual-acceptance.md` records the Story 1.1 comparison, 460 px evidence, contrast result, and two OS screen-reader checks.
- [ ] Focused tests, full Web tests, Web and E2E type checks, relevant HITL specs, and `bun run validate` pass.
- [ ] Implementation preflight finds no active conflicting owner and the final diff contains no unrelated, schema, API, generated, dependency, or migration change.
- [ ] Sprint status is updated only through its owning BMad workflow after all gates pass.

<!-- slug: issue-174-readable-tool-call-row -->
