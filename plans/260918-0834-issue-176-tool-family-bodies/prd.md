# PRD — Issue 176: Tool family bodies (Story 1.3 / FR2 / CAP-2 / UX-DR3)

## Overview

When an operator expands a tool row in the agent node room, Archon currently shows serialized provider data (the Story 1.1 Input/Output bridge, being replaced by Story 1.2's Raw toggle). This feature renders a bounded, readable **body appropriate to the resolved tool family** on both room surfaces (Legacy `NodeRoom` and Console `ConsoleAgentHistoryList`), plus a read-only release audit that fails release when the generic-fallback fraction is `>= 2%`.

## Problem

Expanded tool rows expose raw provider payloads instead of answering "what ran and what came back?". Each tool family needs a purpose-built, bounded presentation; unknown tools need a safe three-row scalar fallback; and the fraction of tools resolving to `generic` must be gated at release time.

## Solution

- A **pure, provider-agnostic, bounded output normalizer** (`packages/web/src/lib/tool-output.ts`) exposing simultaneous semantic channels (text, paths, matches, web results, fields, counts, mode, unreadable).
- A **lazy body resolver** `toolBodyPresentation(input, resolvedFamily)` in `packages/web/src/lib/tool-presentation.ts`, called only while a row is open and Raw is closed. Family resolution stays name/input-only — output never reclassifies.
- Surface-local `ToolBody` JSX on Legacy and Console (no shared React component), stored-markdown-safe rendering, scoped `.tool-family-body .hljs-*` syntax overrides.
- A **read-only generic-fallback audit** (`scripts/audit-generic-fallback.ts`) counting one logical UI tool card per invocation via `projectToolTranscript()`, integrated into `/release` before version mutation.

## Goals and success metrics

- Every in-scope family body (shell/file/search/glob/code/web/generic) plus file preview works identically on Legacy and Console; todo/task get no placeholder body.
- No serialized provider object/array in presented bodies; `{…}`/`[n]` markers and legitimate braces in code/prose allowed.
- All parsing bounded (≈64 Ki text, ≈500 list items, exported constants); closed and Raw-open rows never invoke the body resolver.
- Stored markdown is inert: no active anchors, images, raw HTML, navigation, or fetches.
- 460px contractual panel width: summary and body bar stay one line, no panel-level horizontal scroll, on both surfaces.
- Release rejects missing/stale/hash-mismatched/empty/`>= 2%` generic-fallback records before any version mutation.

## Non-goals

- Story 1.4 diffs, 1.5 todo folding, 1.6 task cards, 1.7 occurrence grouping, steering.
- Changes to stored rows, APIs, schemas, generated types, providers, workflow engine, family resolver, summary-row anatomy, full-output fetch contract, persistence.
- New frontend/runtime dependencies; a shared React component between surfaces.
- Recursive nested-value scans, provider-name branching, natural-language intent parsing in the normalizer.

## Technical context

Authority documents (read first):

- `plans/260918-0834-issue-176-tool-family-bodies/plan.md` + `phase-01-start.md`, `phase-02-two-surface-renderers.md`, `phase-03-audit-gate-and-verification.md` — the full verified plan; phase files carry binding detail.
- `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`, `test-plan.md` — machine contract (Phase 1 corrects known contradictions).
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/` `DESIGN.md`, `EXPERIENCE.md`, `mockups/key-transcript-states.html` — design authority.

Code touch points:

- `packages/web/src/lib/tool-presentation.ts` — existing summary resolver + bounded count extractor; add `ToolBody`/`toolBodyPresentation()` here.
- `packages/web/src/lib/tool-output.ts` — NEW: `normalizeToolOutput`, `NormalizedToolOutput`, `BoundedList<T>` channel contract.
- `packages/web/src/lib/pair-tool-transcript.ts` — `projectToolTranscript()` pairing (audit denominator; do not modify).
- `packages/web/src/components/workflows/NodeRoom.tsx` — Legacy ToolHistory; add local ToolBody + restricted markdown in #175's swap slot (`MARKDOWN_COMPONENTS` ~lines 84-91 must NOT be reused blindly — its `a` renders live links).
- `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` — Console equivalent; import only `@/lib/tool-presentation` (already allowlisted).
- `packages/web/src/index.css` — scoped `.tool-family-body .hljs-*` overrides only.
- `scripts/audit-generic-fallback.ts` — NEW import-safe CLI (`import.meta.main` guard); never import Archon DB adapters (they apply schema on construction).
- `.claude/skills/release/SKILL.md` — pre-mutation record check (may require bundled-skill regen via `check:bundled-skill` diagnostics).
- `e2e/ui/workflow-run-hitl-room.spec.ts`, `e2e/ui/agent-tool-row-visual.spec.ts` — deterministic Read body + Raw swap; route-fulfilled visual gallery.

Key contracts:

- Claude fixtures: pinned `@anthropic-ai/claude-agent-sdk@0.3.209` `sdk-tools.d.ts` output declarations — no exploratory model runs.
- Grep mode precedence: `input.output_mode` → output `mode`/unmistakable structure → sent-alias default (exact `Grep` → `files_with_matches`/paths; lowercase `grep`/other aliases → `content`). `count` → generic body arm + count badge; family stays `search`.
- JSON salvage: bounded tokenizer recovers ONLY `stdout|stderr|text|content|result` values; U+FFFD at cut escapes/lone surrogates; else unreadable.
- Generic: ≤3 combined input+output scalar rows, stable order, `{…}`/`[n]` markers, `11ch` key column.
- Markdown security: `ReactMarkdown` + `remark-gfm` + `remark-breaks` + `rehype-highlight` only; never `rehype-raw`/`dangerouslySetInnerHTML`; `a` → inert label + parenthesized destination; `img` → alt + `[image omitted]`; language auto-detect off.
- Audit threshold: integer compare `genericCards * 100 >= logicalCards * 2` fails; denominator = logical `tool-card`s (pending call-only and legacy result-only count; text/status rows don't).
- Verification: `bun --filter @archon/web test`, `bun run validate`, `bun run --cwd e2e typecheck`, `bun run --cwd e2e test:ui:hitl`. NEVER root `bun test`.

Coordination gates (headless resolutions):

- **#175 (Story 1.2 Raw swap):** Phase 2 renderers occupy #175's presented-body/Raw swap slot. Re-scout merged #175 code first; if still unmerged with no code landed, implement the minimal swap slot (body bar + Raw toggle replacing presented body) in the renderer as part of the story and record it in evidence.
- **Audit-authority blocker:** No human is available. Adopt the plan's documented _Recommended decision_ (logical-tool-cards-v1 denominator, explicit read-only connection args for the selected dialect(s), no implicit `~/.archon`/`DATABASE_URL` target, explicit `--record`, record schema per phase-03, release rejects missing/stale/hash-mismatched/empty/`>=0.02`), record that adoption in `test-plan.md` and `reports/implementation-evidence.md`. If the repo shows the owner already ratified a different policy, implement that instead.

## Story overview

| ID     | Title                                                 | Phase | Depends on |
| ------ | ----------------------------------------------------- | ----- | ---------- |
| US-001 | Bounded semantic output normalizer                    | 1     | —          |
| US-002 | Lazy family-body resolver + spec corrections          | 1     | US-001     |
| US-003 | Legacy ToolBody renderer + safe markdown + scoped CSS | 2     | US-002     |
| US-004 | Console ToolBody renderer + geometry/a11y evidence    | 2     | US-003     |
| US-005 | Read-only generic-fallback audit CLI                  | 3     | US-004     |
| US-006 | Release gate, E2E/visual specs, validation, closeout  | 3     | US-005     |
