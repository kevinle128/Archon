# PRD — Interrupt and redirect a running Claude agent

Source plan: `plans/260919-0139-issue-183-interrupt-and-redirect-claude-agent/plan.md` + `phase-01..05-*.md` (same directory). Issue: https://github.com/kevinle128/Archon/issues/183 — Agent Node Room Story 2.3. Branch: `archon/thread-dffdf57a`.

## Overview

An operator watching a live Claude-backed workflow node can stop **only Claude's current turn** (not the node), inspect the partial outcome, type a correction, and send the pending guidance as the next turn **on the same provider session**. The workflow node stays `running`; node Cancel, sibling execution, and normal DAG progression are untouched.

The successful flow:

1. `Stop` reaches the in-process Claude query through its native `interrupt()` control.
2. The executor classifies the turn end as interrupted: no validation / re-ask / complete / fail; in-flight tool cards settle as `interrupted`; exactly one `interrupted` status row is written; the node enters `idle-after-interrupt`.
3. The dock removes Stop, shows `Send now`, `WILL SEND · n`, and the written-work disclosure.
4. `Send now` drains previously accepted guidance plus the new non-blank message, in registry receipt order, and starts the next turn with the same session id.

## Problem

Story 2.1 delivered a receipt-ordered, in-process steering queue whose messages are delivered only at natural provider-turn boundaries. There is no way to interrupt the *current* Claude turn: the only existing signal (`abortSignal`) is Cancel-grade — it aborts the SDK controller and closes the query, which fails the node. Operators need a distinct, lighter-weight "stop this turn, keep the session, let me redirect" control.

## Goals and success metrics

- Every interrupt-capable direct AI turn, AI-loop turn, and provider-calling loop-group body registers and settles a **tokenized** active turn; terminal paths close/unregister and settle all waiters; AskHuman keeps parking the existing handle/queue for resume.
- Stop calls Claude's native `interrupt()` exactly once through a fresh per-turn signal; never via node Cancel; node remains `running`; next turn resumes the verified same session id.
- `POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt` returns the classified actual outcome: `200 idle-after-interrupt`, `200 generating` (natural end auto-drained pending guidance), or `409 node_finished`. Concurrent/repeated interrupts and sends lose or duplicate no accepted receipt.
- An interrupted end retains usage/cost accounting but performs no output validation, validation-miss event, re-ask, batch partial emission, background-task follow-up wait, node completion, or node failure; outstanding tool UI settles `interrupted`; exactly one interrupted status row is written; no `dag_node_failed`.
- Natural-end races retain normal validation/completion; node Cancel remains dominant and unchanged.
- Idle `send_now` accepts a non-blank new message, returns the immutable `awaiting_send_now` receipt, drains earlier receipts then the new one exactly once, next turn same session.
- Non-Claude providers remain queueable but expose no Stop and no steering sub-state; detached/parked/terminal refusals preserve existing contracts.
- Both web docks match the final design at the authoritative 460px panel width and 1440×900 desktop: no horizontal overflow or control reordering, 32px targets, ≥84px stable send width, token-only styling, scrollable transcript.
- All state transitions meet copy/announcement/alert/contrast/reduced-motion/last-transcript-row-focus criteria in both shells.
- Focused tests, sanitized real-SDK spike report, both-shell Playwright flow, loop parity test, capability-matrix check, type checks, and `bun run validate` all pass before Story 2.3 is marked `done`.

## Non-goals (explicitly out of scope)

- The 30-minute inactivity failure and composing keepalive (Story 2.12) — only the cancel/discard exits needed so an idle node is not uncancellable.
- Withdraw, operator transcript rows, terminal `NEVER SENT` reconciliation, finished-iteration projection, cross-tab queue sync (Stories 2.2, 2.8–2.11).
- Non-Claude provider interruption (Stories 2.4–2.7) — those keep the queue-only Story 2.1 dock, no Stop.
- Mid-turn soft injection and delivered acknowledgements (G1–G4).
- Database migrations, durable queue/sub-state storage, new workflow event kinds, transcript `kind` widening.
- `not_interruptible` error code (conflicts with ratified vocabulary — use existing `422 not_steerable_here`).
- No third dock component; no new breakpoint; no steering SSE event.

## Authority and resolved conflicts

Authority order: (1) Issue #183 + Story 2.3 acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`; (2) ratified machine companions in `_bmad-output/specs/spec-agent-node-room/`; (3) final `DESIGN.md` / `EXPERIENCE.md` then `mockups/key-steering-dock.html`; (4) current source/tests.

Three conflicts resolved by the plan — do not "correct" them back:

- **Focus on Stop removal**: Story 2.3 governs over `EXPERIENCE.md` — focus the **last transcript row** (or transcript scroller if no row), never the send control, never `<body>`. Record the deliberate divergence in component tests.
- **SDK post-interrupt behavior**: `steering-test-plan.md` vs the installed `@anthropic-ai/claude-agent-sdk@0.3.209` declarations disagree. Phase 1's **mandatory real-SDK spike** gates the provider/executor contract — runtime evidence wins.
- **Control styling**: the steering mock's filled-Legacy-send comment is reversed by final `DESIGN.md` (3.06:1 measured contrast). Send and Stop are **bordered, transparent** controls in both shells; only tokens/focus offsets differ.

## Technical decisions (from plan — follow them)

- **D1**: Add `interruptSignal?: AbortSignal` to `AgentRequestOptions`. `abortSignal` stays the long-lived node Cancel. Fresh interrupt controller per provider call (including structured-output re-asks). No `AbortSignal.any`, no magic `reason`, no node-controller mutation.
- **D2**: New required `ProviderCapabilities.interrupt: 'native' | 'stream-abort' | false`. Claude + opt-in e2e-fake = `'native'`; all others `false`. Non-interrupt-capable → queue-only handle, no Stop; a defensive interrupt request maps to `422 not_steerable_here`.
- **D3**: Normalize SDK `terminal_reason` → `MessageChunk.result.terminalReason?: string`. Prefer abort-marked result retaining session id. Only if the spike proves a clean no-result close may the provider emit a normalized interrupted terminal chunk — and only when a real session id was already observed. If no trustworthy session id survives: stop, record blocker; never invent one, never downgrade to Cancel.
- **D4**: Extend the existing registry handle — no second registry. `beginTurn()` → monotonically increasing token; `endTurnStream(token)` clears only that turn's controller; `settleTurn(token, outcome)` resolves only that turn's pending interrupt. `interrupt()` synchronously aborts the current controller and returns one shared settlement promise; repeats share it; idle returns idle immediately; post-stream calls await classification without touching a stale controller. Close/park settles all waiters exactly once.
- **D5**: Five-case end classification: (1) result without abort marker → natural end even if Stop raced; (2) abort-marked result + operator-interrupt flag → interrupted; (3) abort-like throw + operator-interrupt flag → interrupted; (4) other throw → genuine failure; (5) node Cancel wins by position. Only cases 2–3 skip validation/re-ask → idle-await. For Claude, the typed marker is exactly `terminalReason === 'aborted_streaming' || 'aborted_tools'` — no broad prefix matching. Thrown-error helper accepts only recognized abort names/codes/messages with matching turn signal + flag set. Result handler settles still-open tools as `interrupted` **before** the existing map clear. Idle entry writes exactly one `interrupted` status row.
- **D6**: Interrupted end always idles regardless of queue depth. Idle exits only via atomic `send_now`, same-process discard, or cancel-status poll using existing interval/status predicate. No 30-min timer. `accept(message, intent)` is one synchronous mutation covering idempotency + queue insertion + idle release. `send_now` while idle: append non-blank message, drain all receipts in order, claim idle waiter, move handle to generating — same tick. Duplicate message ids replay original receipt. `send_now` while generating/interrupting queues normally. Receipt state is immutable — accepted-while-idle stays `awaiting_send_now` even after release.
- **D7**: Interrupt route awaits executor settlement, returns only the actual outcome (200 idle / 200 generating / 409 `node_finished`). Existing auth/identity and detached/parked refusal mirror send. `WorkflowNodeState.steeringSubState?: 'generating' | 'idle-after-interrupt'` joined from the live in-process registry only — absent for detached, parked, terminal, non-interrupt-capable handles. `interrupting` is a caller-tab-only UI transient. No DB or SSE additions.
- **D8**: Shared dock logic drives both shells: queue-only (no sub-state) → Story 2.1 Queue dock; generating → Stop + Queue; interrupting → focusable `Stopping…` `aria-disabled`, Queue still usable; idle → `Send now` + `WILL SEND · n` + disclosure; resolved generating/terminal → route outcome + authoritative run state. `Send now` requires a non-blank newly typed message; reducer snapshots displayed receipts + new draft into an in-flight batch, clears band optimistically, POSTs only the new message; failure restores full batch at front without re-posting old ids, retains idle, shows `couldn't send · back in the queue` in `role="alert"`.

## Technical context — file map (verified in this checkout)

### Providers (`packages/providers/`)

- `src/types.ts` — `AgentRequestOptions.abortSignal` at line ~593 (add `interruptSignal` beside it); `ProviderCapabilities` consumed at ~880; `MessageChunk.result` carries `toolOutcome?: 'success'|'error'|'interrupted'|'unknown'` at ~388 (add `terminalReason?: string` to the result shape).
- `src/claude/provider.ts` — currently sends a string prompt; existing abort listener is Cancel-grade (`AbortController.abort()` + query close). Add streaming-input path only when `interruptSignal` present; bind `query.interrupt()` once to the turn signal.
- `src/claude/askhuman-resume-spike.ts` — convention for the new `interrupt-resume-spike.ts` diagnostic.
- `src/**/capabilities.ts` — 11 files; Claude + e2e-fake → `'native'`, Codex/Grok/Copilot/DeepSeek/Devin/OMP/OpenCode/Pi/Qoder CLI → `false`.
- `src/registry.test.ts`, `src/observability.test.ts` — capability fixtures needing the new required axis.
- `scripts/generate-capability-matrix.ts` + `packages/docs-web/src/content/docs/reference/provider-capabilities.md` — add a total Interrupt row rendering `native`/`stream-abort`/❌, regenerate.
- SDK pin: `@anthropic-ai/claude-agent-sdk@0.3.209`; `Query.interrupt()` is streaming-input-only; terminal reasons include `aborted_streaming`, `aborted_tools`.

### Engine (`packages/workflows/`)

- `src/steering-registry.ts` — `NodeSteeringHandle` at line 52 (`enqueue` ~65, `closeIfEmpty` ~94, `park` ~112, `discard` ~147); `SteeringRegistry` at 156 (`register` ~165, `unregister` ~190, `discardRun` ~205); `getSteeringRegistry()` ~237. Extend `register(runId, nodeId, { interruptible })`; reuse only when interruptibility agrees, else fail fast.
- `src/dag-executor.ts` — `CANCEL_CHECK_INTERVAL_MS` at 683, `shouldContinueStreamingForStatus` at 701; direct-node `runStreamPass` at ~2267 with `aiClient.sendQuery` at ~2291, mid-stream cancel poll ~2313–2317, `runningTools` settlement (marks `unknown` then clears) ~2536–2564; direct-path `register` ~3002, `closeIfEmpty` ~3337, `unregister` ~3567; AI-loop `register` ~5673, reask fresh-session generator ~6005–6009, loop `closeIfEmpty` ~6883–6887; loop-group bodies run through the direct-node path under namespaced `stepName` (unregister ~5370). Per-pass lifecycle: create fresh turn controller when capability interruptible → register before `sendQuery`, pass `interruptSignal` → capture `terminalReason`/result/session/flag → `endTurnStream(token)` in `finally` → `settleTurn(token, outcome)` after classification.

### Server (`packages/server/`)

- `src/routes/api.ts` — `sendWorkflowNodeRoute` at ~1574 (path `/api/workflows/runs/{runId}/nodes/{nodeId}/send`, `intent: "send_now"` already in schema); `steeringJsonError` ~658; finished-statuses set ~240; `steeringError` helper ~2188. Register the new interrupt route via `registerOpenApiRoute(createRoute({...}))`; switch send to atomic `handle.accept(message, intent)`; join `steeringSubState` into the GET-run node projection.
- `src/routes/schemas/workflow.schemas.ts` — add interrupt response schema + optional `steeringSubState`; keep existing send schemas and `steeringErrorSchema`.
- `packages/web/src/lib/api.generated.d.ts` — regenerate via `bun --filter @archon/web generate:types` with a tracked dev server on port 3090; never hand-edit.

### Web (`packages/web/`)

- `src/lib/steering-dock.ts` + test — framework-free state/reducers: projected sub-state, local `interrupting`, intent-aware receipts, reversible Send-now batches, labels/copy/announcements, generalized steering request error (rename `SteeringSendError` → route-neutral).
- `src/lib/api.ts` — add typed `interruptNode`.
- `src/experiments/console/skills/runs.ts` — Console-owned equivalent helper; no cross-shell imports.
- `src/components/workflows/ComposerDock.tsx`, `NodeTranscriptPane.tsx`, `NodeRoom.tsx` — Legacy controls/focus fallback/last-row marker.
- `src/experiments/console/components/ConsoleComposerDock.tsx`, `ConsoleNodeRoom.tsx`, `inspect/ConsoleAgentHistoryList.tsx` — Console equivalents; `console-isolation.test.ts` must stay green.
- Design authority: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/` — `DESIGN.md`, `EXPERIENCE.md`, `mockups/key-steering-dock.html`. 460px is the only authoritative panel width; 32px min targets; send ≥84px; bordered transparent controls both shells.

### E2E (`e2e/`, `packages/providers/src/e2e-fake/`)

- `src/e2e-fake/provider.ts` — add strict `interruptible: true` scenario (requires `emitTool:true` + positive bounded `delayMs`); interrupt → `tool_result` with `toolOutcome:'interrupted'` then result with same session id + `terminalReason:'aborted_tools'`; defined behavior for interruptSignal outside the opt-in scenario too.
- `e2e/fixtures/workflows/e2e-queue-guidance.yaml` — extend first-turn directive `{"interruptible":true,"emitTool":true,"delayMs":30000}`; `-loop.yaml` → `delayMs:25000`. No duplicate fixtures; don't touch `e2e/lib/playwright/archon-runtime.ts`; keep the existing queue-guidance spec green.
- `e2e/ui/agent-interrupt-redirect.spec.ts` — new both-shell spec.
- `reports/acceptance.md` + `reports/evidence/` — acceptance map, screenshots, measured geometry/contrast JSON.
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` — flip only Story 2.3 to `done` after all gates pass.

## Story overview

| ID | Story | Package focus | Depends on |
| --- | --- | --- | --- |
| US-001 | Claude native interrupt seam + real-SDK gate | `packages/providers`, capability matrix | — |
| US-002 | Registry tokenized turns, executor classification, idle-await | `packages/workflows` | US-001 |
| US-003 | Interrupt route, atomic Send now, sub-state projection | `packages/server`, generated web types | US-002 |
| US-004 | Both web docks, accessibility, visual states | `packages/web` | US-003 |
| US-005 | Deterministic E2E evidence and closeout | `e2e`, e2e-fake, reports, sprint status | US-001–US-004 |

## Conventions and validation

- Bun + strict TypeScript; no `any` without justification; zod v4 conventions per AGENTS.md (`z.record(z.string(), …)`; route registration via `registerOpenApiRoute(createRoute({...}), handler)`).
- Tests are per-package (`bun test <path>` inside the package); never root `bun test`. Mock.module pollution: follow each package's split test invocations.
- TDD per phase: write the listed failing tests first, implement, then run the phase's validation block.
- `interrupting` never enters generated types or node lifecycle; no DB/event/SSE additions anywhere.
- Message text is never logged; errors use stable codes + non-sensitive prose.
- No AI attribution in commits; PR (if in scope) targets `develop`, uses repo template, `Closes #183`.
- Final gate: `bun run generate:capability-matrix && bun run check:capability-matrix && (cd e2e && npm run typecheck) && bun run --cwd e2e test:ui -- --grep 'interrupt and redirect' && bun run validate`.
