# PRD — Issue 174: Readable tool-call row (Epic 1, Story 1.1)

Source plan: `plans/260917-1011-issue-174-readable-tool-call-row/plan.md` + `phase-01-start.md`, `phase-02-two-surface-renderers.md`, `phase-03-end-to-end-visual-verification.md`. Issue: https://github.com/kevinle128/Archon/issues/174

## Problem

Every paired tool call in the Legacy node-room transcript and the Console agent history currently renders as a filled `.ptool` card (`NodeRoom.tsx:227`, `ConsoleAgentHistoryList.tsx:156`) with Input/Output JSON sitting in **open** nested disclosures. An operator cannot scan what ran, its target, or its outcome without reading serialized JSON.

## Solution

Replace each serialized card with **one compact native `<details>` disclosure row** per tool call, identical in meaning on both surfaces:

- A single React-free presentation policy in `packages/web/src/lib/tool-presentation.ts` owns classification (nine families), chip label, headline, status glyph/word, initial-open policy, and ordered typed badges.
- `buildAgentHistory()` (`packages/web/src/lib/agent-history.ts:207`) stays the one projection seam: it gains exit-code propagation, a `presentation` value per tool item, deterministic running elapsed time, and an exact adjacent `interrupted` fold.
- Two thin renderers — Legacy `NodeRoom.tsx` and Console `ConsoleAgentHistoryList.tsx` — own only DOM, elision markup, disclosure state, diagnostic controls, and surface tokens. Neither reclassifies, builds headlines, maps outcomes, orders badges, nor imports the other surface.
- Temporary closed Input/Output diagnostic disclosures preserve today's full-output load/error/retry until Story 1.2 ships the final Raw control.

## Goals / success metrics

- Every paired tool call produces exactly one row in Legacy, Console selected-room history, and Console inline execution history; ordering, paging, extension slots, IDs, and full-output identity unchanged.
- Collapsed summary: chevron → status glyph → family chip → salient headline → non-wrapping right badges; **no** serialized-data punctuation, JSON dump, or visible Input/Output label.
- Table-driven initial state: succeeded/failed/running/interrupted/unknown → closed/open/closed/closed/closed; untouched →failed transitions auto-open once; manual toggles always win; nothing auto-closes.
- Historical rows improve immediately — no migration, flag, or API layer.
- One-line summary at a measured 460 px room width; existing 1440/1024/768/390 sweep and 200% zoom stay usable; no transcript-specific breakpoint.
- All gates green: `bun --filter @archon/web test`, `type-check`, e2e typecheck, `bun run validate`, `bun run --cwd e2e test:ui:hitl`; manual AT + visual acceptance recorded in `reports/visual-acceptance.md`.

## Non-goals (explicitly out of scope)

- Stories 1.2–1.7: final Raw UI, family-specific bodies, diff rendering, todo folding/state, task cards, production-corpus gate, occurrence navigation.
- Operator transcript rows, steering controls/announcements, Chat tool cards, Run Stream `ToolCallItem`, provider execution behavior.
- Backend, API, persistence, schema, migration, generated types, provider, workflow-engine, dependency, or theme-token changes.
- A shared React component/hook, new design tokens, or a new styling system. Small JSX duplication between shells is intentional.
- Collapsed-row `{…}`/`[n]` object/array markers (deferred to Story 1.3 expanded generic body), any live-region announcement channel (NFR8, later steering stories), any new sanitizer (React text nodes only), fake-provider expansion to manufacture visual states.
- `pair-tool-transcript.ts`, server routes/schemas, `api.generated.d.ts`, theme token files are **read-only** unless a failing requirement proves otherwise — stop and revise the plan before expanding.

## Technical context

### Data flow

```
schema-parsed node messages + workflow events
        → pair-tool-transcript (projectToolTranscript — unchanged)
        → buildAgentHistory: outcome/runtime/outputState/exitCode + adjacent interrupted fold + presentation
        → pure toolRowPresentation per tool item
        → Legacy NodeRoom shell  |  Console ConsoleAgentHistoryList shell (both mounts)
        → native <details> + identical semantics
```

### Key files and seams (verified)

| File | Relevant lines |
| --- | --- |
| `packages/web/src/lib/agent-history.ts` | `AgentHistoryInput` :12, `AgentHistoryItem` tool arm :26–41 (`context` :33), `TOOL_CONTEXT_KEYS` :50, `deriveOutcome` :120, `toToolItem` :146, `toolContext` :171, `toolRuntime` :185, `buildAgentHistory` :207 |
| `packages/web/src/lib/format.ts` | `ensureUtc` :2, `formatDurationMs` :28 — reuse for duration badge |
| `packages/web/src/lib/pair-tool-transcript.ts` | `projectToolTranscript`, `ToolTranscriptCard` — read-only; already preserves input/output/exit/identity/occurrence |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx` | `buildAgentHistory` call :236; existing `const nowMs = Date.now()` :284 must hoist above it |
| `packages/web/src/components/workflows/NodeRoom.tsx` | `.ptool` card :227, `item.context` render :246 — Legacy tool markup owner |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` | call :607, `nowMs` :652 |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx` | call :204, `nowMs` :217 — indirect Console mount, regression gate |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | `.ptool` :156, `item.context` :178, tool render :263/:277 — shared by both Console mounts |
| `e2e/ui/workflow-run-hitl.spec.ts` | stale cases `[V:hitl.console-tool-output]` :79 and `[V:hitl.legacy-tool-output]` :94 |
| `e2e/ui/workflow-run-hitl-room.spec.ts` | stale case `[V:hitl.agent-history]` :208 (assertions :219–223) |
| `e2e/ui/workflow-run-hitl-visual.spec.ts` | `.ptool` readiness locator :117 can match hidden descendant text — false positive |

New files: `packages/web/src/lib/tool-presentation.ts` + `.test.ts`, `e2e/ui/agent-tool-row-visual.spec.ts`, `plans/260917-1011-issue-174-readable-tool-call-row/reports/visual-acceptance.md`.

### Core contracts (from plan — authoritative)

- **Row model**: `ToolFamily = shell|file|search|glob|code|todo|task|web|generic`; `ToolPresentationInput = {name, input, output}` (structural, React-free, no `AgentHistoryItem` dependency); `ToolRowFacts` = outcome/exitCode/duration/outputState; `ToolRowBadge` kinds: `state|duration|exit|count|language|operation|output-state|placeholder`; `ToolRowPresentation` = content + glyph + status label + `initialOpen` + ordered badges. Export `toolPresentation(input)` and `toolRowPresentation(input, facts)`; public boundary catches unexpected failure → safe generic row.
- **Resolution order**: (1) bounded `mcp__server__tool` → generic, chip `server · tool`; (2) case-fold + strip `_`/`-` exact alias lookup — never substring (`search_replace` → file, not search); (3) unmatched name → known input keys in contract priority (code+language; command/cmd/script; file path keys; pattern/query; URL keys; before/after); (4) absent/empty input + command-like/overlong multiline name → Codex name-only shell; (5) generic.
- **Alias table** (normalized exact): shell `bash shell run command execute runterminalcommand`; file `edit write create strreplace applypatch notebookedit searchreplace delete read view cat open readfile`; search `grep search rg searchtool`; glob `glob find ls list listdir`; code `eval runcode execute code`; todo `todo todowrite plan`; task `task agent subagent dispatch`; web `webfetch websearch fetch browse`.
- **Headlines**: shell = command/cmd/script or bounded first non-empty name line; strip only complete `/bin/zsh -lc '…'` or `/bin/bash -lc '…'` wrapper; `…` if later non-empty lines. file = first string of `file_path,path,target_file,file,filename,notebook_path`, path kind. search = pattern/query/regex/search + bounded scope. glob = `pattern` headline + `path` scope, else `path` headline (Claude/OMP inversion). code = first non-empty line + language badge. todo = `todo updated` + bounded `op:` badge. task = description → first task name → context first line. web = url/uri, path kind. generic/MCP = ≤3 scalar top-level `key: value` facts in encounter order, else compact label; **no `{…}`/`[n]` in collapsed summary**.
- **Chip**: exact sent name only when one whitespace-free token ≤24 Unicode code points; else family label. Never normalize or CSS-truncate a valid displayed name; never put a rejected name in a11y text/tooltip.
- **Badges** (deterministic order): visible running/interrupted state → content fact (language/count/operation) → exit → non-full output state → duration last. Running = `running · <elapsed>` (suppress premature `missing`); interrupted = `interrupted`; unknown = `output unknown`; settled succeeded/failed keep recorded `truncated`/`output missing`/`output unknown`; no facts → `—` placeholder. Duration is first-drop under width pressure; every hidden fact repeats in the opened body bar (which omits `—`).
- **Bounds** (named constants, test limit and limit+1): `MAX_ALIAS_NAME_CODE_UNITS=128`, `MAX_CHIP_CODE_POINTS=24`, `MAX_HEADLINE_SOURCE_CODE_UNITS=4096` (over-cap → safe fallback, never fabricate a partial path; accepted headlines stay complete in DOM, CSS elides), `MAX_GENERIC_KEYS_SCANNED=32`, `MAX_GENERIC_FACTS=3`, `MAX_GENERIC_SCALAR_CODE_POINTS=80`, `MAX_COUNT_OUTPUT_CODE_UNITS=4096`, `MAX_COUNT_KEYS_SCANNED=32` (count only from bounded scalar/shallow exact count fields; omit on unsupported shapes; never regex prose or fetch full output for a badge).
- **Projection**: exit code once, precedence result→call→card, shared by `deriveOutcome` and presenter. Completed duration = exact single `tool_completed.data.duration_ms` (`toolRuntime`). Running elapsed = exact `tool_called.created_at` via `ensureUtc` + `max(0, nowMs − startedAt)`; invalid/missing/ambiguous → no badge. `AgentHistoryInput` gains required `nowMs`; all three callers pass their existing per-render `Date.now()` snapshot; no new timer.
- **Interruption fold**: single ordered look-ahead in `buildAgentHistory` — a tool card **immediately** followed by a status message with state exactly `interrupted` → tool outcome `interrupted`, status consumed; overrides failed metadata/exit for display (exit badge may remain a fact); never folds across assistant text, another lifecycle row, another tool, on detail text, or on other states; direct-result `interrupted` still works.
- **DOM**: `<details data-tool-id={item.toolUseId}>` keyed by stable item id; direct `<summary>` holds chevron (aria-hidden), visually-hidden status word + visible glyph (aria-hidden), chip (`family · displayed-label` title, family only when identical), headline, ordered badges (visible state badges + `—` are aria-hidden; other facts contribute to accessible name: state → tool/family → target → facts).
- **Disclosure state**: init `open` from `presentation.initialOpen` on mount/identity change only; pointer AND Enter/Space toggles mark touched; untouched →failed opens once; never auto-close; distinguish native user toggle from controlled-prop toggle event; ignore nested toggles (`event.target !== event.currentTarget`); state resets per item identity.
- **Body**: minimal bar starting with family word + all facts (incl. duration); nested Input/Output `<details>` closed by default, styled as real controls (text-secondary, ≥24 px, visible accent focus, native Enter/Space); full-output control/loading/error/retry unchanged; after successful local load, re-run `toolRowPresentation` with loaded output + `outputState:'full'` — stale `truncated` badge gone, disclosure state and item key untouched.
- **Visual**: rest transparent on room surface (no inset fill/border/shadow); hover `surface-hover`; focus 2 px `--accent-bright` outline, offset −2 px Legacy / +2 px Console; transcript padding 10 px/12 px, no inherited `gap-3` between adjacent collapsed tool rows (explicit per-item margins for mixed content); summary 12 px mono w400, 4/6 padding, 8 gap, 6 radius, ≥24 px, one line; chevron 10 px text in 9 px column, 90°/120 ms, `motion-reduce` none; glyph 12 px bold in 12 px column; chip 11 px mono, 1/7 padding, 4 radius, ≤24ch, `surface-elevated` + family tones (shell/code=bash, file/web=command, search/glob=prompt via documented `color-mix`, todo/task=approval, generic=secondary); path headlines = shrinkable secondary head + fixed primary tail (`/` and `\`, trailing separators preserved, tail ≤100% of wrapper with ellipsis); text headlines = end-ellipsis; badges 11 px mono secondary right-aligned no-wrap, duration `flex:0 1 auto` first-drop; nonzero exit digits token-derived error/primary mix ≥4.5:1; body margin 2/0/8/29, 2 px rail, 10 px left padding, 10.5 px mono secondary.

### Resolved conflicts / gotchas

- Verify at **460 px** room width (not the Console mock's 520 px); 24 px minimum target (not stale 22 px).
- Mockups show later stories: comparison limited to row anatomy, default disclosure, minimal body bar, surface behavior; temporary Input/Output bridge is a documented difference.
- Server Zod-parses persisted messages before UI; corrupt rows keep existing API error path — no silent UI repair. `input`/`output` may be any schema-valid JSON value.
- Issue #174 still labeled `status:processing` but its named run completed; PR #194 closed/unmerged (review evidence only — do not cherry-pick). **Re-run ownership preflight before editing**: issue state, open PRs, `git status`, active worktrees.
- CI HITL job selects uppercase `HITL` titles — keep it in all rewritten/new spec titles; `bun run validate` does not run Playwright.

## Story overview

| ID | Story | Depends on | Output |
| --- | --- | --- | --- |
| US-001 | E2E contract rewrite + pure `tool-presentation` policy | — | 3 red HITL cases vs old UI; green bounded resolver/headline/badge unit tests |
| US-002 | History projection: exit code, presentation, interruption fold, `nowMs` | US-001 | `buildAgentHistory` emits renderer-ready items; 3 callers pass clock; E2E still red |
| US-003 | Legacy `NodeRoom` native disclosure row | US-002 | Legacy row + diagnostics + state algorithm; component matrix green |
| US-004 | Console `ConsoleAgentHistoryList` row + `context` cleanup | US-003 | Both Console mounts equivalent; superseded context removed; 3 HITL E2E green |
| US-005 | E2E visual verification + acceptance report + full gates | US-004 | 460 px geometry/focus/motion evidence, `visual-acceptance.md`, all repo gates |

## Validation commands

```bash
# packages/web
bun test src/lib/tool-presentation.test.ts
bun test src/lib/agent-history.test.ts src/lib/pair-tool-transcript.test.ts
NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx
NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx
bun test src/experiments/console/console-isolation.test.ts
bun run type-check

# e2e
npx playwright test -c playwright.config.ts ui/workflow-run-hitl.spec.ts ui/workflow-run-hitl-room.spec.ts --grep "HITL.*readable tool row"
npx playwright test -c playwright.config.ts ui/workflow-run-hitl-visual.spec.ts --grep "HITL"
npx playwright test -c playwright.config.ts ui/agent-tool-row-visual.spec.ts --grep "HITL"
bun run typecheck

# repo root
bun --filter @archon/web test && bun --filter @archon/web type-check
bun run validate
bun run --cwd e2e test:ui:hitl
```
