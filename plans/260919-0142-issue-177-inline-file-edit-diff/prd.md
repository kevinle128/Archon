# PRD — Issue 177: Inline file-edit diff for persisted tool rows

Source plan: `plans/260919-0142-issue-177-inline-file-edit-diff/` (`plan.md`, `phase-01-start.md`, `phase-02-two-surface-renderers.md`, `phase-03-verification-and-closeout.md`). Issue: https://github.com/kevinle128/Archon/issues/177. Branch: `archon/thread-5da49924`. This PRD implements **Story 1.4 / FR5 / CAP-5 / UX-DR3** of the agent-node-room spec.

## Problem

When a persisted `file`-family tool row (e.g. Claude `Edit`) carries both before and after strings, an operator today must open Raw to understand what changed. Both node-room surfaces (Legacy `NodeRoom`, Console `ConsoleAgentHistoryList`) need a fast, trustworthy inline diff: collapsed row shows `+n`/`−m`, body bar states hunk count and `replace_all`, expanded body renders a bounded unified line diff via `react-diff-view`. One-sided, missing, refused, or unreadable pairs must keep the existing path-plus-preview fallback — the UI must never invent a missing side.

## Mandatory product-contract gate — RESOLVED to presentation-only

The plan is `status: blocked` on a spec conflict: CAP-5 says "Codex never qualifies and falls back to path plus preview", but repository evidence shows successful Codex `file_change` events never become persisted file tool rows at all — `packages/providers/src/codex/provider.ts:709` emits `file_change` as a `system` chunk, and `packages/workflows/src/dag-executor.ts:2691-2748` debug-logs unhandled generic system chunks (`dag.system_message_unhandled`) instead of appending them to the node transcript.

**Resolution (chosen, headless): Option 1 — presentation-only scope.** The plan's entire technical design, bounds, and test matrix assume this option; Option 2 (real Codex transcript coverage) crosses the no-backend/provider boundary and requires its own re-plan, which does not exist. US-001 records this resolution in the authoritative docs:

- Amend CAP-5, Story 1.4, `tool-presentation-contract.md`, and `test-plan.md` to say: **any persisted file row without both sides falls back to path plus preview; current Codex `file_change` system chunks are explicitly out of scope.**
- Successful Codex file-change transcript visibility remains separately tracked work — this feature must never claim it.
- A fake-provider no-input row is **generic defensive coverage**, never "Codex proof". Tests, reports, and docs must use that label.

## Solution overview

Pure data path in `packages/web/src/lib/`, two thin local renderers, no shared React component:

```text
stored AgentHistoryItem
  -> toolPresentation / toolRowPresentation
       resolve 'file' family + own-property before/after pair
       -> row WeakMap  ->  bounded pair LRU  ->  jsdiff structuredPatch
       -> sanitized GitDiffHunk[] + added/deleted counts | null
       -> +n / −m badges, N hunk(s) + replace_all facts
  -> open row, Raw closed
       -> local Legacy or Console renderer (react-diff-view)
            changed: path + .tool-diff table
            identical: path + "no changes"
            missing/refused: unchanged path + preview fallback
            failed changed row: second inset box with normalized failure output
  -> Raw open: original stored payload, unchanged
```

Deterministic bounds: 65,536 UTF-8 bytes/side, 2,000 logical lines/side, `maxEditLength: 2_000`, 4 context lines (pinned v9 default, passed explicitly). No elapsed-time timeout. `null` = not qualified/refused → fallback; `{ hunks: [] }` = identical pair → `no changes`.

## Goals and success metrics

- Qualified two-sided `file` rows produce deterministic hunks, snippet-relative 1-based line numbers, `+n −m` badges, and `file · N hunk(s) · replace_all: <bool>` facts on **both** Legacy and Console.
- Every non-qualifying case (one-sided, no-input, oversized, over-line, over-edit, thrown, non-file) preserves today's fallback with zero fabricated diff.
- Repeated presentation of a stable row calls the differ once (row `WeakMap`); equal strings on a re-parsed row hit the dual-bounded pair LRU (256 entries / 1,048,576 source code units).
- Inserted/deleted code+markers visibly use success/error treatments; `+`/`−` (U+2212) remain as required non-color cues; measured contrast ≥ 4.5:1 in both themes/surfaces/states.
- Geometry: at Legacy 460px, Console 520px, shared 460px, and 390×844 — summary stays one line, long code wraps, no room-level horizontal overflow.
- `bun run validate` green; sprint-status `1-4-view-a-file-edit-as-an-inline-diff: done` only after all evidence; PR uses repo template with `Closes #177`.

## Non-goals

- Real-provider/transcript/storage/API/schema changes — Codex `file_change` persistence is explicitly excluded by the gate resolution.
- Syntax highlighting, word-level diff, file-offset inference, whitespace-insensitive diff, virtualization, split view, shared React UI, file navigation, run-level file panel.
- Editing `sources/spec-readable-agent-transcript/` (superseded, audit-only).
- No serialized JSON body, no added focus target, no network request or file read on expand/toggle.

## Technical context (real anchors)

| File                                                                                     | Role                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/tool-presentation.ts`                                              | Family inference (`inferFamily` :460, `BEFORE_AFTER_PAIRS` :142, `hasOwn` :232), badge types (`ToolRowBadgeKind` :55, `ToolRowBadgeTone` :64), `toolRowPresentation` :748, file body arm |
| `packages/web/src/lib/tool-output.ts`                                                    | `sanitizeBounded` :191 — reuse for diff line sanitization (1,024 cap)                                                                                                                    |
| `packages/web/src/components/workflows/source-control/git-hunk-adapter.ts` (+`.test.ts`) | **Move to `src/lib/`**; converts generated `GitDiffHunk`→`HunkData`; must use `@/lib/api.generated` types only                                                                           |
| `packages/web/src/components/workflows/source-control/virtualized-diff.tsx`              | Proven `react-diff-view` import pattern; update adapter import only                                                                                                                      |
| `packages/web/src/lib/node-message-pages.ts`                                             | Preserves row-object identity on normal merges → justifies WeakMap fast path                                                                                                             |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                     | Legacy renderer host (separate JSX by design, UX-DR3)                                                                                                                                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`    | Console renderer host; bans component imports + runtime `@/lib/api`                                                                                                                      |
| `packages/web/src/experiments/console/console-isolation.test.ts`                         | Approved `@/lib/*` set :115-133 — add `@/lib/git-hunk-adapter` with comment                                                                                                              |
| `packages/web/src/index.css`                                                             | Add one scoped `.tool-diff` block beside tool-family body styles                                                                                                                         |
| `packages/providers/src/e2e-fake/provider.ts`                                            | `scenarioSchema` :128, exclusivity refinement :142-155, `toolInput` emission :426/:450/:472 — extend with `fileEdit` enum                                                                |
| `packages/providers/src/codex/provider.ts:709`                                           | `file_change` → system chunk (evidence for gate; do not modify)                                                                                                                          |
| `packages/workflows/src/dag-executor.ts:2691-2748`                                       | Unhandled system chunks debug-logged (evidence for gate; do not modify)                                                                                                                  |
| `e2e/lib/playwright/archon-runtime.ts`                                                   | Fixture registration + CLI runner helpers                                                                                                                                                |
| `_bmad-output/specs/spec-agent-node-room/`                                               | `SPEC.md` (CAP-5), `tool-presentation-contract.md`, `test-plan.md` — owning docs                                                                                                         |
| `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`                         | Story 1.4                                                                                                                                                                                |
| `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/`       | `EXPERIENCE.md` (behavior) + `DESIGN.md` (visuals) are authoritative over `mockups/key-transcript-states.html`                                                                           |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`               | Closeout target                                                                                                                                                                          |

Dependencies: `@archon/web` pins `react-diff-view@3.3.3`; add exact `diff@9.0.0` (hoisted `diff@8` is unrelated). Verified v9 behavior: 4-line default context, `undefined` over `maxEditLength`, no hunks for identical input, `\\ No newline` markers as separate entries (can repeat mid-array), fixture order = context → deletes → inserts.

## Resolved design discrepancies (do not re-litigate)

- Mockup shows absolute line numbers (~211); `FileEditInput` has no offset → use honest 1-based snippet-relative numbers, recorded as a deviation.
- Mockup alternates deletes/inserts; jsdiff v9 groups deletes before inserts → preserve library order, never reorder.
- `DESIGN.md` requires whole deleted/inserted **rows** (code + marker) in error/success color, not just markers.
- Reference widths: Legacy 460px, Console 520px; also test shared 460px and 390×844.

## Story overview

| ID     | Title                                               | Maps to         | Depends on |
| ------ | --------------------------------------------------- | --------------- | ---------- |
| US-001 | Resolve product-contract gate (presentation-only)   | Plan "Gate" row | —          |
| US-002 | Bounded differ, adapter move, presentation contract | Phase 1         | US-001     |
| US-003 | Inline diff on Legacy and Console                   | Phase 2         | US-002     |
| US-004 | Deterministic full-stack proof and closeout         | Phase 3         | US-003     |

## Validation commands

```bash
# US-002
cd packages/web && bun test src/lib/diff-hunks.test.ts src/lib/git-hunk-adapter.test.ts src/lib/tool-presentation.test.ts
cd packages/web && NODE_ENV=development bun test src/components/workflows/source-control/
bun run type-check && bun run lint && bun run format:check

# US-003
cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx
cd packages/web && NODE_ENV=development bun test src/experiments/console/
cd packages/web && bun test src/lib/diff-boundary.test.ts
bun --filter @archon/web test

# US-004
bun --filter @archon/providers test
bun run --cwd e2e typecheck
bun run --cwd e2e test:ui -- --grep 'file-edit'
bun run --cwd e2e test:ui:hitl
bun run validate
```

Never run root `bun test` — package splits prevent `mock.module()` pollution. Do not start a second dev server when the e2e harness owns one.

## Key invariants

- `src/lib/diff-hunks.ts` is the **only** production module allowed to import/call `structuredPatch`; renderers must not import `diff` or `@/lib/diff-hunks`.
- Diff the raw strings; sanitize (ANSI/C0/C1 strip, Cf + U+2028/U+2029 escaped as `\u{HEX}`, 1,024-code-unit cap + ellipsis) only the stored display content. Raw keeps the original payload.
- Cache key retains source text → the source-weight budget (1,048,576 code units ≈ 8 max pairs) is mandatory, not optional.
- Factory options must be positive finite integers; fail fast on invalid config. No test-only cache clearing or patch seams on the default singleton.
- No component test timeout widening; near-5s tests get JUnit timing analysis first.
- If inserted/deleted foreground fails 4.5:1, mix only that scoped foreground toward `--text-primary` and re-measure the full matrix — never lower the floor or drop the non-color signs.
