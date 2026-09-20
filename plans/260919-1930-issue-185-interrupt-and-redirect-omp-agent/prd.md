# PRD: Interrupt and redirect a running OMP agent (Issue #185 / Story 2.5)

Source plan: `plans/260919-1930-issue-185-interrupt-and-redirect-omp-agent/plan.md` + `phase-01..03-*.md` (same directory). Issue: https://github.com/kevinle128/Archon/issues/185. Sprint key: `2-5-interrupt-and-redirect-a-running-omp-agent` in `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:72`.

## Overview / problem

While an OMP-backed workflow node is generating, an operator presses `Stop`, which must end only the current provider turn and reach `idle-after-interrupt` — not cancel or fail the node. `Send now` then drains queued guidance in receipt order as the next turn on the same OMP session. Work already completed is not rolled back.

Story 2.3 / PR #214 already shipped the in-process steering registry, route authorization, queue ordering, executor idle-await, server projection, and both composer docks — all provider-neutral. Issue #185 is the **provider conformance slice**: prove the installed OMP CLI can be gracefully interrupted and resumed, normalize that end into the existing executor contract via a deterministic `stream_aborted` terminal marker, and expose the already-shipped UI states by flipping OMP's capability.

OMP is a one-shot `--mode json` child process (no RPC/ACP). Its session id exists only inside a `session` JSONL event OMP emits; a Stop that kills the child before that event makes same-session redirect impossible, so the design defers a pre-header interrupt for a bounded 500 ms rather than refusing to spawn.

## Solution

1. Characterize the exact installed OMP binary with a sanitized real-binary spike (assistant-text interrupt + active-tool interrupt), on every platform where the capability will be advertised.
2. Implement a first-cause-aware termination seam in `OmpProvider` + `OmpEventParser`: pending-header deferral, termination-ownership tracking, buffered-text drain, truthful `resumed` reporting, and a normalized interrupted `result` carrying `terminalReason: 'stream_aborted'` — never a throw (a throw can't carry a first-turn session id).
3. Export `STREAM_ABORTED_TERMINAL_REASON` from the provider contract and add it to the executor's marker set; prove direct and AI-loop executor conformance with OMP-shaped fixtures.
4. Flip `OMP_CAPABILITIES.interrupt` to `'stream-abort'` **only after** the gate passes; sync canonical spec companions, regenerate the capability matrix, update OMP user docs, close sprint status.

## Goals + success metrics

- `OMP_CAPABILITIES.interrupt === 'stream-abort'`; registry pins Claude as the only `'native'` and OMP as the only `'stream-abort'` provider.
- Version/platform-keyed sanitized spike evidence covers every advertised platform: session header precedes work events, graceful termination (SIGTERM on POSIX, no SIGKILL), full provider return < 1,000 ms from signal, exact same-id resume with context intact, zero owned descendants alive.
- Immediate and mid-turn Stop preserve partial assistant text + observed/fail-soft-enriched usage + real session id; exactly one last result carries `stream_aborted` with no completion/error fields.
- Cancel dominates a co-fire; first-cause transport/protocol failures and force-kill escalation remain failures; natural-end race stays natural; all listeners/timers/children cleaned up.
- Direct and AI-loop OMP fixtures idle without `node_failed`, keep node `running`, write one interrupted status, resume same id, drain guidance in written order.
- Canonical companions, provider type docs, OMP user docs, and generated matrix agree; historical `sources/` copies untouched; no server/UI production file changes.
- `bun run validate` passes (twice — once before, once after the sprint-status flip to `done`).

## Non-goals

- OMP RPC/ACP mode and soft inject (`steer`, `set_steering_mode`, `abort_and_prompt`).
- New routes, authorization rules, persisted steering state, database changes, or UI components.
- Codex, Grok, DeepSeek provider implementations (stories 2.4, 2.6, 2.7).
- Changing the shared 30-min idle-await behavior, delivery confirmation, `NEVER SENT` reconciliation, OMP argv/env/spawn permissions, hidden-session storage, or the 5-second SIGKILL fallback duration.
- Generic process-tree infrastructure — unless the spike proves OMP leaves a descendant alive, in which case the plan is BLOCKED (orphaning is not an acceptable follow-up).
- Re-running the Legacy/Console E2E (`e2e/ui/agent-interrupt-redirect.spec.ts`) — provider-only change; it is mandatory only if a server/UI production file unexpectedly changes.
- Editing `_bmad-output/specs/spec-agent-node-room/sources/` (historical inputs) or hand-editing the generated matrix.

## Technical context (verified file references)

### Provider seam (Phase 1)

- `packages/providers/src/community/omp/capabilities.ts:25` — `interrupt: false`; flip to `'stream-abort'` only after the gate. The constant has **no platform dimension**, while `binary-resolver.ts` supports macOS/Linux/Windows — a macOS-only pass must not silently expose Stop elsewhere.
- `packages/providers/src/community/omp/provider.ts` — `terminate()` at :208 sends SIGTERM then schedules the 5 s SIGKILL fallback (:210). Unlabelled `terminate()` call sites at :396, :407, :419, :437, :443, :518; node-level `abortSignal` pre-spawn guard at :317 and listener wiring at :424-426, :450; completion path :515-518. Keep ONE termination path; add first-writer-wins cause: `interrupt` | `interrupt-unresumable` | `cancel` | `transport` | `protocol` | `cleanup`, plus whether the scheduled SIGKILL callback actually ran.
- `packages/providers/src/community/omp/event-parser.ts` — `sessionId` field :47, missing-header error at :82-88, `getSessionId()` :127, `session` event handling :160-165 (swallowed — stores id, emits no chunk), `tool_execution_start/end` :184-189/:279-316, `agent_end` :207-213, `flushAssistant()` :335. Add narrow methods only: `hasSession()`, `hasTurnActivity()`, `hasNaturalTurnEnded()`, `beginOperatorInterrupt()`, `drainPendingAssistant()`, `buildInterruptedResult(resumed)`.
- `packages/providers/src/types.ts` — `terminalReason` doc :350-356 (currently says "provider-native … Claude `terminal_reason`" — stale, must cover adapter-synthesized markers); `resumed` contract :357-366; `interruptSignal` doc :601-609 (says `'native'` only — stale); capability union `'native' | 'stream-abort' | false` :843-847. Export `STREAM_ABORTED_TERMINAL_REASON = 'stream_aborted' as const` here.
- Spike precedent to mirror: `packages/providers/src/claude/interrupt-resume-spike.ts` + `packages/providers/package.json:39` (`"spike:interrupt:claude": "bun src/claude/interrupt-resume-spike.ts"`). New OMP spike is NOT exported; script `spike:interrupt:omp`.
- `resolveOmpBinaryPath` in `binary-resolver.ts`; operator's existing OMP login; unique `mkdtemp` git repo; track owned PIDs, reap in `finally`, no broad `pkill`, record only sanitized facts (version, OS/arch, event-type order, timings, exit classes, hashed session correlation — never prompts, generated text, credentials, raw session ids).
- Installed `/Users/agent/.bun/bin/omp` reports **18.1.21**; an existing scout report describes 18.1.16 source — supporting evidence only, not a runtime guarantee.

### Provider result normalization rules

- Interrupt-ownership won + graceful reap → drain buffered assistant text once → yield ONE last `result` with session/accounting fields (`tokens`, `cost`, `numTurns`, `usageBreakdown`, `resolvedModel`), truthful `resumed`, `terminalReason: STREAM_ABORTED_TERMINAL_REASON`. Omit `stopReason`, `structuredOutput`, `isError`, `errorSubtype`, `errors`. Then existing hidden-session usage enrichment (fail-soft) and return — no trailing throw.
- `resumed` on interrupted results only: ordinary `--resume` → true iff observed id === requested id; `--fork` → true iff OMP emitted a session header; no resume requested → omit field; else false. Non-interrupted resume/fork semantics unchanged.
- Pre-header Stop: wait at most `INTERRUPT_SESSION_HEADER_WAIT_MS = 500`; fire SIGTERM the moment the parser consumes the header, before yielding later work. Turn activity before header, deadline expiry, or early exit/failure → `interrupt-unresumable` termination + unmarked `omp_interrupt_session_unavailable` error — never idle, never invent an id.
- SIGKILL fires → drain safe buffered text, emit ONE unmarked `isError` result `errorSubtype: 'omp_interrupt_force_killed'` — executor must fail, not idle.
- Interrupt mode in parser: errored `tool_execution_end` for a tool active at interrupt start → `tool_result` with `toolOutcome: 'interrupted'`, no failure warning; late successful end stays `success`; still-open tools stay open for executor settlement. Normal parsing byte-for-byte unchanged when interrupt mode never begins.
- Cancel (`abortSignal`) keeps its pre-spawn guard and wins final classification whenever `abortSignal.aborted`, even if Stop fired first. Co-fire sends at most one SIGTERM.

### Executor (Phase 2)

- `packages/workflows/src/dag-executor.ts:457-460` — `INTERRUPT_TERMINAL_REASONS` set (`'aborted_streaming'`, `'aborted_tools'`); `isInterruptTerminalReason` :462-464; used at :2692 (direct) and :6413 (AI loop). `interruptSignal` passed at :2435 and :6325. Change = import the shared constant + add to set + update comment. Do NOT branch on `'native'` vs `'stream-abort'`, do NOT touch `isAbortLikeStreamError`, queue ordering, Cancel, idle timeout, or session selection.
- `packages/workflows/src/dag-executor.test.ts` — helper `assistant: 'claude' | 'pi' | 'devin'` at :25914, Pi special-casing; `interrupt and redirect (#183)` describe at :27068 with `opts` helper at :27179. Widen narrowly for `'omp'` + add `omp: {}` test config; OMP provider is registered at module load and `getAgentProvider` stays mocked — no binary launches. No loop-group duplicate (loop-group prompt bodies delegate to the direct path; #183 pins namespacing).

### Docs / closeout (Phase 3)

- `_bmad-output/specs/spec-agent-node-room/engine-integration.md` and `steering-test-plan.md` — both currently say OMP interrupt throws `Query aborted`; update root companions to the normalized marked-result shape while RETAINING executor case-3 and a thrown-abort regression fixture. Do not edit `sources/` copies or weaken Story 2.5 conditional Given/Then.
- `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` — smallest user-facing OMP Stop/resume/failure-boundary note in the existing OMP section.
- `packages/docs-web/src/content/docs/reference/provider-capabilities.md` — regenerate only: `bun run generate:capability-matrix` then `bun run check:capability-matrix` (generator `scripts/generate-capability-matrix.ts` already renders `**stream-abort**`). OMP cell under `Turn interrupt (operator Stop)` → `**stream-abort**`; Claude stays `**native**`.
- Sprint status `backlog` → `done` only after spike + focused gates + matrix check + scope check + preliminary validate are all green; then final `bun run validate`.

### Environment caveat

The plan review's focused test run failed on `@archon/paths` module resolution — an environment issue, not a behavior signal. First step of US-001 is `bun install --frozen-lockfile` at repo root, then the focused baseline. Never run root `bun test`; use `bun run validate` at root and `bun test <path>` inside packages.

## Story overview

| ID     | Title                                                           | Phase | Depends on |
| ------ | --------------------------------------------------------------- | ----- | ---------- |
| US-001 | Baseline + OMP interrupt spike harness and raw characterization | 1     | —          |
| US-002 | Provider/parser stream-abort seam (TDD)                         | 1     | US-001     |
| US-003 | Real-binary conformance gate, report, capability flip           | 1     | US-002     |
| US-004 | Executor `stream_aborted` marker + OMP conformance tests        | 2     | US-003     |
| US-005 | Contract/docs sync, matrix regeneration, sprint closeout        | 3     | US-004     |

## Hard rules carried from the plan

- The capability flip is gated on observed graceful behavior per advertised platform. If a platform cannot be tested or cannot pass, do NOT ship a static `'stream-abort'` anyway — leave `interrupt: false`, record the blocker in the spike report and plan, and surface it for an owner decision. Forceful termination is never SIGTERM success.
- If the SIGKILL fallback fires, the result is an unmarked `omp_interrupt_force_killed` error — the node fails, never idles on an unproven session.
- If the spike finds a surviving owned descendant (OMP child tool), the plan is BLOCKED — orphaning is not an acceptable follow-up.
- Fail fast and explicit: missing/late/out-of-order session headers fail within the bounded pre-header path; no fabricated session ids; no silent fallbacks.
- `bun run validate` from the repo root is the final gate — never root `bun test`.
