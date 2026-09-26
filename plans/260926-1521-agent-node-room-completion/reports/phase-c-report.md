# Phase C report: readable tool presentation in RunStream, Chat, and backend formatting

Worktree: `/Users/dale/orca/Archon/.claude/worktrees/agent-a09a449fa6a84e962`
Branch: `worktree-agent-a09a449fa6a84e962`

Scope: Stories 4.2 (RunStream), 4.3 (Chat), 4.4 (backend tool formatting), plus a
cross-surface fixture set proving Node Room, RunStream, Chat, and the backend
formatter agree on family, headline, outcome, and badge order for the same event.

## Story 4.2 — Console RunStream

**Files:**

- `packages/web/src/experiments/console/components/ToolCallItem.tsx` (rewrite)
- `packages/web/src/experiments/console/components/ToolCallItem.test.tsx` (new)
- `packages/web/src/experiments/console/components/RunStream.tsx` (`pairToolEvents`)
- `packages/web/src/experiments/console/components/RunStream.test.tsx`
- `packages/web/src/experiments/console/primitives/event.ts` (`ToolCallEvent`, `toRunEvent`)
- `packages/web/src/experiments/console/primitives/event.test.ts`
- `packages/web/src/experiments/console/primitives/message.ts` (`InlineToolCall`, `toMessage`)
- `packages/web/src/experiments/console/primitives/message.test.ts`

**What changed.** `ToolCallItem` used to always render two open, pretty-printed
JSON blocks with no chip, glyph, or badges. It now calls `toolRowPresentation`
from `@/lib/tool-presentation` (the same function Node Room uses) and renders a
collapsible row: status glyph, family chip, headline, right-aligned badges. A
successful call collapses by default; a failed call opens automatically
(`presentation.initialOpen`). Opening it (Raw closed) shows a lean, JSON-free
body per family (terminal/file/matches/paths/code/web/task/generic) built from
`toolBodyPresentation`; a Raw toggle, closed by default, is the only path to
the literal payload (`toolRawPayloadJson`).

**A real gap this surfaced and fixed.** `toRunEvent()` discarded the
`tool_outcome`/`exit_code` fields `dag-executor.ts` already persists on
`tool_completed` events, hardcoding `{ ok: true }` for every completed call.
That meant a failed or interrupted tool always rendered as a plain success in
RunStream. `ToolCallEvent.result` now carries `{ outcome, durationMs, exitCode }`
mapped from the persisted `tool_outcome` (`error → failed`, `interrupted`,
`unknown`; absent → `succeeded`, for rows written before the field existed).
`pairToolEvents` threads this through to `InlineToolCall`. This is read-only on
`event.ts`/`RunStream.tsx`, both files this phase owns — no change to
`dag-executor.ts`.

**A live-transition bug caught before commit.** Seeding `useState(presentation.initialOpen)`
only applies once, at mount — a call polled in as `running` and later resolved
to `failed` on the same mounted row never reopened. Fixed with the same
`touched` + `useEffect` pattern already used by the Node Room row component
(`ConsoleAgentHistoryList.tsx:826-852`, read for reference only, not edited):
an untouched row opens once when it turns failed; nothing auto-closes a row
the reader already opened or closed by hand.

**Chat's inline tool calls (`InlineToolCall`, message-inline path) carry no
failure signal at all** — only whether a result (output or duration) has
arrived. `outcome` there is `running`/`succeeded` only; this is an honest
reflection of what `toMessage()`'s wire format actually carries, not a guess.

## Story 4.3 — Chat (also the Legacy run stream)

**Files:**

- `packages/web/src/components/chat/ToolCallCard.tsx` (rewrite)
- `packages/web/src/components/chat/ToolCallCard.test.tsx` (new)
- `packages/web/src/test/install-happy-dom.ts` (new, shared test helper)

**Scope note:** `WorkflowLogs.tsx` (the Legacy run stream) renders tool calls
through `MessageList` → `ToolCallCard` — the exact same component Chat uses.
One rewrite covers both surfaces; no separate Legacy-specific change was
needed or made.

**What changed.** `ToolCallCard` kept its chevron-button shell and live
1-second elapsed tick, but now resolves the same `toolRowPresentation` output
as Console and Node Room, replacing the ad-hoc "Complete/Running/Cancelled/Stopped"
pill and always-visible raw JSON blocks. `chatToolOutcome()` documents its own
ceiling: an operator-cancelled call proves interruption (`interrupted`); a
`stopped` call (run ended while the tool was open) proves nothing about the
tool itself, so it degrades to `unknown` rather than a guessed `interrupted` —
this mirrors `WorkflowLogs.tsx`'s existing `terminalToolStatus` semantics.
Chat has no exit-code or output-truncation signal today, so those badges never
appear here (honest, not a bug). The same `initialOpen`/`touched` live-reopen
fix from 4.2 was applied here from the start (the bug was caught during 4.2,
before 4.3's card existed).

**New shared test helper.** `AskCard.test.tsx` already carries its own private
copy of the happy-dom install/restore pair (needed for `act()`-driven click
tests in `src/components/`); this is now the third site needing it, so it was
extracted to `packages/web/src/test/install-happy-dom.ts` (mirrors Console's
own copy in `experiments/console/test/`, which stays as-is per the Console
isolation boundary). `AskCard.test.tsx` itself was not touched — deduplicating
it was out of this phase's scope and risked touching Node-Room-adjacent test
code another agent may be editing.

## Story 4.4 — Backend tool formatting

**Files:**

- `packages/workflows/src/utils/tool-formatter.ts` (rewrite)
- `packages/workflows/src/utils/tool-formatter.test.ts` (rewritten expectations)
- `packages/workflows/src/utils/tool-formatter.fixtures.test.ts` (new)
- `packages/workflows/src/utils/tool-formatter-boundary.test.ts` (new)
- `fixtures/tool-presentation/cases.json` (new, repo root)
- `packages/web/src/lib/tool-presentation-fixtures.test.ts` (new)

**Design.** `@archon/workflows` cannot depend on `@archon/web` (package order
runs the other way, and `@archon/web` is not a declared dependency). Per
`test-plan.md`'s own framing ("one serializable fixture set... package-boundary
checks prove... fixture parity proves agreement across the boundary"), the
sanctioned design is two independent implementations proven equal by shared
fixtures — not a new shared package. `resolveToolPresentationSummary()` in
`tool-formatter.ts` is an independent port of the same four-tier resolution
contract (alias table, duck-typed input keys, Codex name-only fallback,
bounded generic fallback) reduced to the summary layer a compact text message
needs: family, chip label, headline, outcome glyph, ordered badges. No body,
no diff (the differ — `diff-hunks.ts` — is an explicit `@archon/web`-only
dependency per `tool-presentation-contract.md`), no output-state tracking
(this call site only ever announces a call before its result exists).

`formatToolCall(toolName, toolInput?)` keeps its exact original signature —
`dag-executor.ts` and `orchestrator-agent.ts` (both out of this phase's
ownership) call it unchanged. Internally it calls the new resolver with
`{ outcome: 'running' }` (the only outcome this call site ever has — it is the
pre-execution announcement) and drops the resulting `state` badge from its
compact text (the glyph already says "running"; repeating it in every message
would be noise), keeping only input-derived badges (language, an operation,
a subtask count).

**Behavior change, and why it is correct.** The old formatter's fallback for
an unrecognized tool was `JSON.stringify(toolInput).slice(0, 80)` — exactly
the raw-JSON-dump pattern CAP-2/CAP-16 ban. It now shows up to 3 scalar
`key: value` facts, bounded at 80 code points each, matching the Web
resolver's generic tier exactly. `tool-formatter.test.ts` was rewritten
end-to-end against the new compact format (`◐ [label] headline` with an
optional badge suffix); no assertion was weakened, each was re-derived from
the actual new behavior. `orchestrator.test.ts`/`orchestrator-agent.test.ts`
mock `formatToolCall` entirely, so they were unaffected.

**Cross-surface fixture set.** `fixtures/tool-presentation/cases.json` (repo
root, owned by neither package) holds 14 cases spanning all 9 families plus
an MCP shape, a Codex-wrapped multi-line name, running/interrupted/unknown
outcomes, and a failed exit-1 shell call. Each case's `expected` block (family,
label, headline, headlineKind, glyph, badges) was captured by running the real
`toolRowPresentation()` against the case, then independently reproduced by
`resolveToolPresentationSummary()` before being written into the fixture —
both were verified to produce byte-identical output before the file was
finalized, so the fixture is not a guess transcribed from one side.

- `packages/web/src/lib/tool-presentation-fixtures.test.ts` asserts
  `toolRowPresentation()` (the function Node Room, RunStream, and Chat all
  call directly) against every fixture — proving those three surfaces agree,
  since they share the exact function under test.
- `packages/workflows/src/utils/tool-formatter.fixtures.test.ts` asserts the
  independent backend resolver against the same fixtures.
- `packages/workflows/src/utils/tool-formatter-boundary.test.ts` parses
  `tool-formatter.ts`'s own import statements and asserts none of them is
  `@archon/web`, a `packages/web` path, or a relative `../web/` escape — and
  that the file has no imports at all, guarding against silent scope creep
  back toward a shared module.

**Documented scope boundary: diff badges.** File-family `+n/−m` diff badges
depend on `diff-hunks.ts`, an explicit `@archon/web`-only dependency. The
shared fixture's file-family case (`Read`, no `old_string`/`new_string` pair)
was deliberately chosen so neither side produces a diff badge, sidestepping
the need to port the differ. This is a scope decision, not an oversight — the
existing `packages/web/src/lib/tool-presentation.test.ts` (not touched by this
phase) already covers diff-badge correctness on the Web side in depth.

## Fixture parity design (summary)

One fixture set, two independent resolvers, proven equal:

```
fixtures/tool-presentation/cases.json
        │
        ├─ packages/web/src/lib/tool-presentation-fixtures.test.ts
        │     → toolRowPresentation()  (Node Room + RunStream + Chat all call this)
        │
        └─ packages/workflows/src/utils/tool-formatter.fixtures.test.ts
              → resolveToolPresentationSummary()  (backend platform adapters)
```

Neither test file imports the other package's code; both load the same JSON
via `readFileSync` + `import.meta.dir`-relative paths (4 levels up from each
package's `src/*/` to the repo root), validated at the boundary with a runtime
type guard before use (a malformed fixture throws loudly rather than silently
typing as `any`).

## Tests

- `packages/web/src/experiments/console/primitives/event.test.ts` — outcome/exit-code mapping (succeeded default, error→failed, interrupted, unknown)
- `packages/web/src/experiments/console/primitives/message.test.ts` — inline tool call outcome derivation
- `packages/web/src/experiments/console/components/RunStream.test.tsx` — `pairToolEvents` outcome/exitCode threading
- `packages/web/src/experiments/console/components/ToolCallItem.test.tsx` — collapsed-by-default/expanded-on-failure, exit badge, glyph+sr-label decodability without colour, running/interrupted badges, path elision, generic fallback safety, Raw toggle closed-by-default/reveal/hide
- `packages/web/src/components/chat/ToolCallCard.test.tsx` — same coverage adapted to `ToolCallDisplay`'s narrower signal set (no exit code, no failed outcome)
- `packages/workflows/src/utils/tool-formatter.test.ts` — rewritten for the new compact format, generic fallback safety
- `packages/workflows/src/utils/tool-formatter.fixtures.test.ts` + `packages/web/src/lib/tool-presentation-fixtures.test.ts` — cross-surface parity, 14 fixtures × 2 implementations
- `packages/workflows/src/utils/tool-formatter-boundary.test.ts` — package-boundary guard

### `bun run validate` results

Run after each story's changes, from the worktree root: exit 0, 0 failures,
every leg green (type-check, lint --max-warnings 0, format:check, and the full
`bun run test` across all packages including the new/changed suites above).
Re-ran clean a final time after story 4.4 before this report was written.

## Visual verification

Isolated instance: copied `~/.archon/archon.db`/`config.yaml`/`credential-key`
into a scratch `ARCHON_HOME`; server on port 3320
(`ARCHON_HOME=... TELEGRAM_BOT_TOKEN= SLACK_BOT_TOKEN= DISCORD_BOT_TOKEN=
WORKFLOW_RUN_RETENTION_DAYS=36500 SESSION_RETENTION_DAYS=36500 PORT=3320 bun
--watch src/index.ts`); web on port 5190 (`PORT=3320 npx vite --port 5190
--strictPort`). Screenshots captured with Playwright's cached
`chrome-headless-shell` (no browser automation tool was available; Chrome.app
itself failed to launch through a space-free symlink, so the standalone
headless-shell binary from `~/Library/Caches/ms-playwright` was used instead).
Both processes were stopped (`kill` on the two ports) after capture.

- `plans/260926-1521-agent-node-room-completion/evidence/phase-c/runstream-console.png` —
  Console RunStream for run `9314eb315a98799cc08d8fbd3cbfa09c`: chip labels
  (Bash/Read/Agent/ToolSearch/TaskCreate), checkmark glyphs, elided headlines,
  and duration/truncation badges — no raw JSON visible in the collapsed rows.
- `plans/260926-1521-agent-node-room-completion/evidence/phase-c/chat-tool-calls.png` —
  Legacy Chat conversation `web-1790406924125-238422` (found by querying for a
  non-hidden conversation with persisted `toolCalls` metadata; the run's own
  worker conversation turned out to be a `hidden=1` internal row the messages
  API 404s on by design, and the `/api/conversations/:id/*` routes key on
  `platform_conversation_id`, not the conversation's internal `id` — both
  discovered while picking a URL to screenshot). Same glyph/chip/headline/badge
  presentation as Console, including a resolved `archon · AskHuman` MCP-style
  row, proving the Chat rewrite renders identically to RunStream for the same
  kind of event.

## Deviations from the brief and why

- **`initialOpen` used on Chat, not just Node Room/RunStream.** The brief
  doesn't explicitly say Chat should auto-expand a failed call; CAP-1's
  wording is scoped to the Node Room read contract. Since `toolRowPresentation()`
  already computes `initialOpen` as part of the shared summary, and Chat is
  required to "consume the shared Web semantic presentation," using it
  keeps all three surfaces mechanically consistent. In practice this never
  fires for live Chat data today, because Chat's outcome model can only ever
  be `running`/`succeeded`/`interrupted`/`unknown` (never `failed`) — see the
  honesty note above.
- **`AskCard.test.tsx`'s duplicate happy-dom helper was not deduplicated.**
  A third copy would have been created either way (Rule of Three); extracting
  the shared one instead of taking a third private copy is the DRY-correct
  call, but retrofitting `AskCard.test.tsx` to use it was left alone — that
  file sits in the Node-Room-adjacent test tree another agent may be touching.

## Unresolved questions

- None blocking. If a future change adds a failure signal to Chat's SSE
  `onToolResult` wire format (or to `BufferedToolCall` server-side), the
  `chatToolOutcome` mapping should switch a real `failed` state through
  instead of falling back to `succeeded`/`unknown` — currently there is no
  such signal to plumb, and adding one was outside this phase's file
  ownership (it would touch `ChatInterface.tsx`'s SSE handlers and the
  server-side message persistence path).
