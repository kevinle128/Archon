# ANR Story 1.1 — Readable Tool Call Row Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md`
Derived slug: `2026-09-16-anr-1-1-readable-tool-call-row`
Issue: https://github.com/anhle128/Archon/issues/174

## Overview

Agent Node Room (ANR) Story 1.1 replaces each always-open tool-call JSON card with one scannable disclosure row on both the Legacy run room and the Console inspect room. Operators should be able to scan tool activity — family, headline, outcome, and key facts — without wading through raw serialized payloads in the collapsed state.

The implementation plan is authoritative for Story 1.1 scope. Conflict resolution order: Story 1.1 acceptance criteria, the tool-presentation contract plus adopted architecture decisions, the test plan, then finalized DESIGN and EXPERIENCE (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:34`).

## Problem

Today each tool call renders as an always-open card with nested Input/Output JSON blocks. The collapsed summary does not exist, so scanning a long transcript is slow and noisy. `AgentHistoryItem` exposes a `context` array built from a handful of input keys (`packages/web/src/lib/agent-history.ts:33`, `50`, `159`, `171-183`) while the exit code is resolved inside `deriveOutcome()` but never carried on the item (`packages/web/src/lib/agent-history.ts:120-136`, `146-168`). Legacy and Console are the only production readers of `item.context` (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:94-95`).

Status must remain understandable without colour: literal glyphs `✓`, `✕`, `◐`, `⚠`, and `–` with colour as reinforcement only (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:27-28`).

## Solution

Introduce a React-free resolver in `packages/web/src/lib/tool-presentation.ts` that classifies provider payloads and produces payload-derived collapsed-row facts. Extend `packages/web/src/lib/agent-history.ts` to attach that presentation, carry `exitCode`, own the complete ordered badge and status text projection, and fold an immediately following `interrupted` lifecycle row into the preceding tool item. Legacy (`NodeRoom.tsx`) and Console (`ConsoleAgentHistoryList.tsx`) retain separate JSX but consume the same render-neutral data and use native `<details>/<summary>` disclosure semantics.

The expanded disclosure body temporarily keeps the existing Input and Output blocks until Stories 1.2–1.3 replace them (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:62-63`).

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| One-line scannable summary | Each tool call on Legacy and Console renders chevron, glyph, family chip, headline, and right-aligned badges in one `<summary>` | `NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx` readable-row tests (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:1034-1035`) |
| Shared projection | Five-outcome initial expansion table, glyph/label maps, badge order, and interrupted fold live in `agent-history.ts` | `agent-history.test.ts` expansion, badge-order, and fold tests (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:1035-1042`) |
| Safe degradation | Malformed input resolves to generic without throwing; generic headlines use at most three scalar pairs | `tool-presentation.test.ts` malformed and generic tests (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:1040-1041`) |
| Live polling respect | Untouched running row auto-opens on failure; reader-toggled rows keep manual choice | Legacy and Console live-transition tests (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:1036-1037`) |
| Story closeout | `sprint-status.yaml` marked `done`, evidence file recorded, `bun run validate` passes | Task 6 gate (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:1044`, `1011-1015`) |

## Non-Goals

- Story 1.2 per-card Raw toggle and final JSON surface (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:54`).
- Story 1.3 family-shaped expanded bodies (terminal, diff, matches, paths, code, file-preview, web, generic) (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:55`).
- Stories 1.4–1.7 (inline diffs, todo strip, task subtasks, occurrence grouping) (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:56-60`).
- Schema, migration, server route, backend formatter, dependency, feature flag, or env var changes (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:20`).
- Importing `@archon/workflows` from `@archon/web` (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:21`).
- Console importing Legacy components, stores, contexts, routes, hooks, or `@tanstack/react-query` (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:22`, `console-isolation.test.ts`).
- Partial `body` union or second generic/terminal body in expanded region (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:62-63`).

## Technical Context

### Global constraints

- Changes stay inside `@archon/web`; strict TypeScript, zero ESLint warnings (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:23-24`).
- Chip uses sent tool name only when one whitespace-free token ≤ 24 chars; otherwise family name (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:24`).
- Normalized tool names match exactly after case-folding and removing `_`/`-`; never substring alias match (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:25`).
- Collapsed summary free of raw serialized JSON (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:26`).
- Family colour tokens: `--node-bash` (shell/code), `--node-command` (file/web), `--node-prompt` (search/glob), `--node-approval` (todo/task), `--text-secondary` (generic) (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:28-29`).
- Native `<details>/<summary>`; manual reader choice survives live re-renders (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:31`).
- Focused tests: `bun test --cwd packages/web src/lib/...` etc.; never `bun test` from repo root (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:32`).

### Current repository facts

- `AgentHistoryItem` tool arm includes `context` at `packages/web/src/lib/agent-history.ts:33`; `deriveOutcome()` resolves exit code at lines 126-129 but `toToolItem()` does not expose it (`packages/web/src/lib/agent-history.ts:146-168`).
- `TOOL_CONTEXT_KEYS` and `toolContext()` at `packages/web/src/lib/agent-history.ts:50`, `171-183`.
- Legacy constructs tool `AgentHistoryItem` literals in `packages/web/src/components/workflows/NodeRoom.test.tsx`.
- Console tests feed wire rows through `buildAgentHistory()` with top-level `metadata` (`ConsoleNodeRoom.test.tsx`).
- Existing Console test at `ConsoleNodeRoom.test.tsx:1002` expects an open successful tool card and must move to the disclosure contract.
- Closed native `<details>` content remains in DOM; tests inspect `details.open` and `<summary>` text, not absence of body from DOM (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:98`).

### New and modified files

| File | Role |
| --- | --- |
| `packages/web/src/lib/tool-presentation.ts` | Pure resolver, `FAMILY_CHIP_TOKEN`, `elideHeadline()` |
| `packages/web/src/lib/tool-presentation.test.ts` | Family, chip, MCP, shell wrapper, generic scalar, elision tests |
| `packages/web/src/lib/agent-history.ts` | `exitCode`, `presentation`, `toolRowView()`, `initialToolExpanded()`, interrupted fold |
| `packages/web/src/lib/agent-history.test.ts` | Projection, expansion table, badge order, fold tests |
| `packages/web/src/components/workflows/NodeRoom.tsx` | Legacy native disclosure row |
| `packages/web/src/components/workflows/NodeRoom.test.tsx` | Legacy summary, a11y, live-transition tests |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | Console native disclosure row |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` | Console row and transition tests |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | Mark `1-1-scan-a-tool-call-as-one-readable-row: done` after gate |
| `_bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md` | Test results and acceptance map |

### Settled decisions

- `state === 'interrupted'` is the exact lifecycle marker for fold (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:80-81`).
- MCP `server · tool` label falls back to `generic` when > 24 chars (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:81`).
- `exit N` badge only for non-zero finite exit code (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:82`).
- Badge order: payload facts → non-zero exit → output-state marker → duration; only duration is droppable (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:83-85`).
- Missing input (`undefined`) and empty `{}` = Codex name-only shell path (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:85`).
- Generic headline: at most three scalar top-level pairs; ignore nested objects/arrays (`docs/superpowers/plans/2026-09-16-anr-1-1-readable-tool-call-row.md:87-88`).

### Implementation order

1. Family classification resolver (Task 1).
2. Chip, headline, elision, generic safe-degradation (Task 2).
3. Shared projection + interrupted fold (Task 3) — **required before either shell**.
4. Legacy disclosure (Task 4).
5. Console disclosure + isolation (Task 5).
6. Remove `context`, evidence, validate, sprint done (Task 6).

## Story Overview

| Priority | Story | Title | Depends on | Plan anchors |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Classify tool calls to families | — | Task 1, lines 102-297 |
| 2 | US-002 | Complete chip, headline, and safe-degradation display | US-001 | Task 2, lines 300-477 |
| 3 | US-003 | Project shared tool row data and fold interrupted lifecycle | US-002 | Task 3, lines 481-675 |
| 4 | US-004 | Render Legacy native disclosure row | US-003 | Task 4, lines 679-816 |
| 5 | US-005 | Render Console native disclosure row | US-004 | Task 5, lines 820-928 |
| 6 | US-006 | Remove superseded context and close Story 1.1 | US-004, US-005 | Task 6, lines 932-1028 |
