---
title: 'Issue 177 inline file-edit diff'
description: 'Verified implementation plan for Story 1.4: bounded inline diffs for persisted two-sided file tool rows on Legacy and Console.'
status: done
priority: P1
effort: '3 phases (~3.5d) after the product-contract gate'
issue: 'https://github.com/kevinle128/Archon/issues/177'
branch: archon/thread-5da49924
tags: [issue-177, agent-node-room, epic-1, web, frontend, feature, tdd]
blockedBy: []
blocks: []
created: 2026-09-19
baseline: 81ba296f
---

# Issue 177 inline file-edit diff

## Goal and user outcome

Give an operator a fast, trustworthy view of a persisted file edit without opening Raw. When a `file`-family tool row has both before and after strings, its collapsed row shows `+n` and `−m`, its body bar describes the hunk count and `replace_all`, and its expanded body renders a bounded unified line diff through `react-diff-view` on both Legacy and Console. A one-sided, missing, refused, or unreadable pair must keep the existing path-plus-preview fallback; the UI must never invent the missing side.

This is the actual need expressed by Story 1.4 / FR5 / CAP-5 / UX-DR3. The presentation-only solution below completely serves persisted tool rows. It does **not** make successful Codex `file_change` events appear as rows; that contract conflict is a mandatory gate below.

## Mandatory product-contract gate

Repository evidence does not permit the draft's conclusion that a synthetic no-input `edit` row proves Codex behavior:

- Claude tool calls persist their input and can produce a two-sided `Edit` row.
- `packages/providers/src/codex/provider.ts` emits `file_change` as a `system` chunk containing formatted paths.
- `packages/workflows/src/dag-executor.ts` does not append a successful generic Codex system chunk to the node transcript; it debug-logs the unhandled chunk. No file row reaches either renderer.
- CAP-5 says “Codex never [qualifies] and falls back to path plus preview,” while the same spec constrains the read half to no provider/backend/schema change.

Before Phase 1, the product/spec owner must choose and record one of these mutually exclusive outcomes:

1. **Presentation-only scope:** amend CAP-5, Story 1.4, and the test plan to say that any persisted file row without both sides falls back, and explicitly exclude current Codex system chunks. Keep successful Codex file-change transcript visibility as separately tracked work. Then this plan is implementation-ready as written.
2. **Actual Codex coverage:** retain the Codex acceptance language and expand/re-plan the story to persist a structured Codex file-change transcript item with path and preview. That crosses the current no-backend/provider boundary and requires its own storage/transcript compatibility analysis and tests before this UI plan can close Issue 177.

Do not begin implementation, mark the sprint item done, or close Issue 177 until this gate is resolved. A fake-provider row with no input remains useful defensive coverage, but it must never be labeled Codex proof.

## Verified authority and evidence

- Product contract: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` Story 1.4; `_bmad-output/specs/spec-agent-node-room/SPEC.md` CAP-5; `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`; `_bmad-output/specs/spec-agent-node-room/test-plan.md`.
- Design authority: `_bmad-output/specs/spec-agent-node-room/SPEC.md` makes `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` authoritative for behavior and the adjacent `DESIGN.md` authoritative for visual treatment. The reconciliation/validation documents make those spines higher authority than `mockups/key-transcript-states.html` where they differ.
- Required visual anatomy: native `<details>`, `+n −m` badges, `file · 1 hunk · replace_all: false`, inset body, a 3ch right-aligned number column, success-colored inserted rows, error-colored deleted rows, and normal context rows. The signs are required non-color cues.
- Current presentation path: `packages/web/src/lib/tool-presentation.ts` owns family inference, before/after aliases, summaries, body facts, and the file fallback; `NodeRoom.tsx` and `ConsoleAgentHistoryList.tsx` own separate JSX by design.
- Render frequency: `buildAgentHistory()` is invoked in render bodies in `NodeTranscriptPane.tsx`, `ConsoleNodeRoom.tsx`, and `ConsoleExecutionHistory.tsx`. `node-message-pages.ts` preserves existing row objects while merging normal poll results. This supports a row-object `WeakMap`, but also requires a string-pair cache when rows are re-parsed.
- Existing diff integration: `git-hunk-adapter.ts` converts generated `GitDiffHunk` values to `react-diff-view` `HunkData`; `virtualized-diff.tsx` proves the package/runtime import pattern. Console bans component imports and runtime `@/lib/api`, so the adapter must move to pure `lib/` and use `api.generated` types.
- Dependencies: `@archon/web` pins `react-diff-view` at `3.3.3` and has no direct `diff` dependency. The hoisted `diff@8` is unrelated; add exact `diff@9.0.0` rather than relying on it.
- Pinned-library behavior was checked against the packages themselves: jsdiff v9 defaults to four context lines, returns `undefined` when `maxEditLength` is exceeded, emits no hunks for identical inputs, and emits no-newline markers as separate `\\ ...` entries. For the mockup fixture it emits both deletes followed by both inserts. `react-diff-view` renders two gutter cells and wraps code by default.
- Provider/e2e behavior: the e2e fake provider accepts optional `toolInput`, so it can prove a defensive no-input fallback; it cannot prove Codex serialization or persistence.

## Resolved design discrepancies

- The HTML mockup shows absolute line numbers around 211, but `FileEditInput` has no file offset. Use honest, 1-based snippet-relative line numbers and record that deviation in visual evidence.
- The mockup visually alternates deleted/inserted lines. The canonical contract requires jsdiff output; v9 groups this fixture's deletes before inserts. Preserve library order—do not reorder changes and risk corrupting hunk semantics.
- The draft colored only markers while leaving changed code in the primary text color. `DESIGN.md` requires the whole deleted/inserted row to use error/success color. Phase 2 now applies and measures those colors.
- There is no transcript-specific breakpoint. Capture each artifact's desktop reference width (Legacy 460px, Console 520px), test the shared 460px minimum directly on both, and test a 390px viewport to ensure the inherited room layout does not overflow.

## Technical design

1. `packages/web/src/lib/diff-hunks.ts` is the only production caller of `structuredPatch`. It is React-free and provider-neutral and returns generated `GitDiffHunk[]` plus added/deleted counts.
2. A pair qualifies only for the resolved `file` family and only when one existing alias pair (`old_string`/`new_string`, `old_str`/`new_str`, `content`/`new_content`) exists as own properties and both values are strings. Empty strings are valid sides.
3. Bounds are deterministic: 65,536 UTF-8 bytes per side, 2,000 logical lines per side, `maxEditLength: 2_000`, and four context lines (the pinned v9 default, made explicit). There is no elapsed-time timeout.
4. Logical line counting is `0` for `''`; otherwise newline count plus one when the value does not end in `\n`. Stop as soon as the cap is exceeded.
5. A code-unit length above the byte cap is an O(1), uncached refusal. All smaller pairs enter a least-recently-used pair cache before UTF-8 measurement. Cache both successful and computed-refusal results.
6. The pair cache has two limits: 256 entries and 1,048,576 total source code units (`before.length + after.length` per key). The weight budget equals eight maximum-size pairs, preventing the entry limit from retaining roughly 64 MiB of UTF-16 key text while still allowing hundreds of ordinary small edits. Refresh on hit and evict the oldest entries until both limits hold. A row-object `WeakMap` in `tool-presentation.ts` makes stable-row renders O(1).
7. The hunk walker handles context/delete/insert entries with running old/new counters and skips every `\\ No newline at end of file` entry wherever it appears. Every emitted positive line number must pass the existing adapter.
8. Diff computation uses raw sides. Before storage in a rendered change, strip ANSI/C0/C1 controls with `sanitizeBounded`, visibly escape Unicode format controls (general category `Cf`, including bidi and zero-width controls) plus line/paragraph separators (`U+2028`, `U+2029`) as ASCII `\\u{HEX}`, then enforce the 1,024-code-unit display limit with an ellipsis. This prevents deceptive visual order or fake rows without changing Raw.
9. `null` means not qualified or safely refused; it yields no diff badge/fact and uses the existing fallback. `{ hunks: [] }` means a valid identical pair; show `file · no changes` and an explicit `no changes` body note.
10. Nonempty changes add `+n` (success tone) and `−m` (danger tone) badges and `N hunk(s)` plus `replace_all: <boolean>` body facts. The body bar excludes diff badges to avoid repeating counts.
11. Both renderers use `react-diff-view` locally; they share only the pure data and adapter modules. Raw continues to replace the normalized body. A failed edit shows its normalized output in a second body box beneath the diff; successful provider prose stays behind Raw.
12. Single-hunk diffs omit an `@@` decoration. Later hunks get a text-only separator before the hunk so omitted context is apparent.

## End-to-end behavior

```text
stored AgentHistoryItem
  -> toolPresentation / toolRowPresentation
       resolve family and own-property pair
       -> row WeakMap
            -> bounded pair LRU
                 -> jsdiff structuredPatch
                 -> sanitized GitDiffHunk[] + added/deleted counts | null
       -> badges and body facts
  -> open row, Raw closed
       -> toolBodyPresentation uses the same cached result
       -> local Legacy or Console renderer
            changed: path + react-diff-view table
            identical: path + "no changes"
            missing/refused: unchanged path + preview fallback
            failed changed row: second box with normalized failure output
  -> Raw open: original stored payload, unchanged
```

## Scope

In scope after the gate resolves to presentation-only:

- Exact `diff@9.0.0` dependency, bounded/memoized differ and tests.
- Move the existing hunk adapter to `src/lib`, update its consumer/tests, and preserve generated API types.
- Presentation badges, facts, body diff data, Unicode-safe line display, and stable-row memoization.
- Separate Legacy and Console renderers, shared scoped CSS, component/interaction/boundary tests.
- Four deterministic fake-provider rows—successful edit, failed edit, one-sided write, and generic no-input—and two-surface Playwright evidence. The no-input row is defensive generic coverage.
- Minimal owning contract/test-plan updates, visual evidence, validation, sprint closeout.

Out of scope:

- Real-provider/transcript/storage changes unless the gate chooses actual Codex coverage; that choice requires a revised plan.
- Schema/API/migration changes, syntax highlighting, word-level diffing, file-offset inference, whitespace-insensitive diffing, virtualization, split view, shared React UI, file navigation, or a run-level file panel.

## File inventory

| Path                                                                                                                                                                                                                                                          | Change                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/web/package.json`, `bun.lock`                                                                                                                                                                                                                       | exact `diff@9.0.0` dependency                                    |
| `packages/web/src/lib/diff-hunks.ts`, `packages/web/src/lib/diff-hunks.test.ts`                                                                                                                                                                               | bounded conversion, dual-bounded LRU, line sanitization          |
| `packages/web/src/lib/git-hunk-adapter.ts`, `packages/web/src/lib/git-hunk-adapter.test.ts`                                                                                                                                                                   | move from `components/workflows/source-control`; generated types |
| `packages/web/src/components/workflows/source-control/virtualized-diff.tsx`                                                                                                                                                                                   | adapter import only                                              |
| `packages/web/src/lib/tool-presentation.ts`, `packages/web/src/lib/tool-presentation.test.ts`                                                                                                                                                                 | pair qualification, WeakMap, badges/facts/body result            |
| `packages/web/src/components/workflows/NodeRoom.tsx`, `packages/web/src/components/workflows/NodeRoom.test.tsx`, `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                                                                              | Legacy renderer and behavior                                     |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`, `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx`, `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` | Console renderer and behavior                                    |
| `packages/web/src/experiments/console/console-isolation.test.ts`                                                                                                                                                                                              | approve pure adapter import                                      |
| `packages/web/src/lib/diff-boundary.test.ts`                                                                                                                                                                                                                  | one jsdiff owner and renderer dependency boundaries              |
| `packages/web/src/index.css`                                                                                                                                                                                                                                  | scoped table, gutter, wrapping, state colors                     |
| `packages/providers/src/e2e-fake/provider.ts`, `packages/providers/src/e2e-fake/provider.test.ts`                                                                                                                                                             | deterministic success/failure/write/no-input scenarios           |
| `e2e/fixtures/workflows/e2e-file-edit.yaml`, `e2e/lib/playwright/archon-runtime.ts`                                                                                                                                                                           | fixture and runner                                               |
| `e2e/ui/file-edit-diff.spec.ts`                                                                                                                                                                                                                               | behavior, geometry, contrast, both surfaces                      |
| `_bmad-output/specs/spec-agent-node-room/SPEC.md`, `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`                                                                                                                                           | record the product-gate resolution in CAP-5 and Story 1.4        |
| `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`, `_bmad-output/specs/spec-agent-node-room/test-plan.md`                                                                                                                               | verified behavior, limits, and proof scope                       |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`, plan `reports/`                                                                                                                                                                   | closeout only after all acceptance evidence                      |

## Acceptance criteria

- [x] The product-contract gate is resolved in the authoritative specs; tests and closeout make no false Codex claim.
- [x] Qualified both-sides rows produce deterministic valid hunks, counts, snippet-relative numbers, and `+n −m`; identical sides show `no changes`.
- [x] One-sided, no-input, oversized, over-line, over-edit, thrown, and non-file cases never fabricate a diff and preserve path/preview fallback.
- [x] Exact-bound, limit-plus-one, empty-side, CRLF, repeated text, repeated/doubled no-newline markers, malformed control/Unicode-format content, cache hit/refresh/count eviction/weight eviction, and adapter-conversion tests pass.
- [x] Repeated presentation of one row invokes the pair differ once; an equal pair on a new row hits the pair LRU; normal polling retains the row-object fast path.
- [x] Legacy and Console render equivalent path/body-bar/badge/table/no-changes/failure/fallback/Raw states. There is no serialized JSON or added focus target.
- [x] Inserted and deleted code, gutter, and marker visibly use success and error treatments with the signs as non-color cues; context remains normal.
- [x] At each surface's desktop reference width, at a shared 460px room width, and at a 390×844 viewport, the summary remains one line, long code wraps, and no room-level horizontal overflow appears.
- [x] Browser measurements are at least 4.5:1 for changed text/markers/numbers against their actual computed backgrounds and for diff badges in rest and hover states, in both themes/surfaces.
- [x] Console isolation, the single-`structuredPatch` boundary, the moved adapter/source-control regression, provider fixture tests, focused UI tests, existing HITL room tests, and `bun run validate` pass.

## Phases

| #    | Phase                                                                                  | Dependency | Deliverable                                          |
| ---- | -------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------- |
| Gate | Product-contract decision above                                                        | none       | authoritative Codex scope; plan unblocked or revised |
| 1    | [Bounded differ, adapter move, presentation contract](./phase-01-start.md)             | Gate       | pure data path and unit contracts                    |
| 2    | [Inline diff on Legacy and Console](./phase-02-two-surface-renderers.md)               | Phase 1    | both renderers, CSS, component/boundary proof        |
| 3    | [Deterministic full-stack proof and closeout](./phase-03-verification-and-closeout.md) | Phase 2    | browser evidence, full validation, closeout          |

## Validation strategy

Write the focused test first in each phase, make the smallest production change, then broaden:

```bash
cd packages/web && bun test src/lib/diff-hunks.test.ts src/lib/git-hunk-adapter.test.ts src/lib/tool-presentation.test.ts
cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/source-control/
cd packages/web && NODE_ENV=development bun test src/experiments/console/
bun --filter @archon/web test
bun --filter @archon/providers test
bun run --cwd e2e test:ui -- --grep 'file-edit'
bun run --cwd e2e test:ui:hitl
bun run validate
```

Never run root `bun test`; package splits prevent `mock.module()` pollution.

## Compatibility, operations, and rollback

- No migration or API rollout is required for the presentation-only outcome. Existing stored rows and one-sided payloads remain compatible.
- All diff work is synchronous but deterministically bounded by bytes, lines, edit length, and memory budgets. A refusal is a normal fallback, not a run failure.
- No network request or file read is introduced by expanding/toggling a row.
- Add the dependency and implementation in one focused commit; revert that commit to roll back. The adapter move is mechanical and must revert with its import updates. Stored data is untouched.
- Do not change the sprint status to `done` until browser evidence and full validation pass. Do not claim actual Codex coverage unless the gate expands the design and that path is tested end to end.

## Risks and safeguards

- Synchronous Myers work: line and edit caps bound the graph; real limit tests must prove refusal without widening a timeout.
- Cache retention: enforce both entry and source-weight budgets and test LRU refresh and both eviction causes.
- Approval-surface deception: render sanitized/escaped line content while Raw retains the original; assert one DOM row per emitted change.
- Theme contrast: use token colors required by DESIGN, measure actual mixed backgrounds in a browser, and mix the affected success/error foreground toward `--text-primary` if needed; never lower the 4.5:1 floor.
- Test duration: keep fixtures small and use JUnit timings before considering any timeout change.

## Definition of done

The gate is resolved, every acceptance criterion has recorded evidence, phase exit criteria pass, `bun run validate` is green, authoritative docs match shipped behavior, the sprint entry is `done`, and the PR uses the repository template with `Closes #177`. If the gate selects actual Codex coverage, this definition cannot be met until the expanded provider/transcript plan is accepted and implemented.

## Independent re-review

1. **Product goal and user outcome:** the plan serves inline edit comprehension but exposes the unresolved Codex visibility gap instead of masking it.
2. **Architecture and technical correctness:** pure computation remains in `lib`, generated types feed the existing adapter, and both shells keep required local JSX.
3. **Public and internal contracts:** stored/API shapes and Raw stay stable; CAP-5 must be reconciled before implementation; Console import boundaries are explicit.
4. **Security, reliability, and data integrity:** work and retained memory are bounded, deceptive controls are visible/removed, and refusal never mutates source data.
5. **Performance and scalability:** stable rows use a WeakMap, re-parsed equal values use a dual-bounded LRU, and unsafe inputs fall back before costly work.
6. **Implementation completeness:** dependency, conversion, presentation, both renderers, CSS, fixture, evidence, docs, and closeout all have named owners and order.
7. **Testing and verification:** unit, component, interaction, boundary, provider-fixture, responsive, contrast, regression, and full validation gates cover the behavior end to end.
8. **Operations, compatibility, migration, and rollback:** no migration, staged dependency plus code, explicit fallback, evidence-gated rollout, and one focused revert path.
9. **Simplicity and long-term maintainability:** one differ, one existing adapter, two thin required renderers, and no speculative provider or UI abstraction.
