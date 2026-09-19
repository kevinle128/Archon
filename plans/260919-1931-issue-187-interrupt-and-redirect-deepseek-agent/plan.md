---
title: 'Issue 187 interrupt and redirect a running DeepSeek agent'
description: 'Implementation-ready plan for Agent Node Room Story 2.7: give the DeepSeek community provider the operator Stop seam (ACP cancel-and-continue on a per-turn signal), teach the executor to classify its abort-marked result as an interrupted end, and prove same-session redirect on both the direct and loop paths.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/187'
branch: archon/thread-e3d2ab87
tags: [issue-187, agent-node-room, providers, deepseek, workflows, tdd, deep]
blockedBy: []
blocks: []
created: 2026-09-20
---

# Issue 187: interrupt and redirect a running DeepSeek agent

## Goal and user outcome

An operator watching a live DeepSeek-backed node presses `Stop`; the current DSH turn is cancelled through ACP's own `session/cancel` primitive, the node stays `running`, the dock enters `idle-after-interrupt`, and `Send now` continues the same logical ACP session with earlier queued guidance followed by the new message. Any tool call cut mid-flight shows `⚠` (interrupted) in the transcript. This is Story 2.7 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (lines 614–638) and issue #187.

Story 2.3 (#183, commit `79ed773a`) already shipped the whole steering machinery: `interruptSignal` on `AgentRequestOptions`, the `ProviderCapabilities.interrupt` axis, tokenized turns in `steering-registry.ts`, five-case turn-end classification and idle-await in `dag-executor.ts` (direct and AI-loop paths), the interrupt route, sub-state projection, and both web docks. Every one of those layers gates on `getProviderCapabilities(provider).interrupt !== false` (`dag-executor.ts:3196`, `:5964`), not on a provider id. **Story 2.7 is therefore a provider-seam story**: flip the DeepSeek capability, plumb the turn signal into the ACP client, stamp the abort-marked result so the executor's classifier recognises it, and prove it against real DSH. Nothing in the registry, route, or dock is re-planned here.

## Authority and resolved conflicts

1. Issue #187 and Story 2.7 acceptance criteria in `epics.md`.
2. `_bmad-output/specs/spec-agent-node-room/` — `SPEC.md:133` (five-case rule names DeepSeek's `stopReason:'aborted'` as the abort marker), `engine-integration.md:33`, `steering-test-plan.md:18,41`, `provider-steering-matrix.md:18,59–63`.
3. Current source and the Story 2.3 plan (`plans/260919-0139-issue-183-interrupt-and-redirect-claude-agent/`) for integration shape.

Conflicts resolved explicitly:

- **"Keeps the session alive" for DeepSeek means the ACP session id survives, not the process.** `runDeepseekAcpTurn` spawns one DSH child per turn and the `finally` at `acp-client.ts:356–366` always sends `session/close`; the redirect turn is a fresh child doing `session/resume` (`acp-client.ts:290–300`). Story 2.7's own phrase "preserved logical session" is the hook; the matrix's "warm connection, 31 ms" measurement describes DSH's runtime, not Archon's per-turn transport. The plan does not introduce a long-lived child.
- **`'native'`, not `'stream-abort'`.** The matrix row (`provider-steering-matrix.md:18`) and Story 2.7's wording ("uses its cancel-and-continue mechanism", distinct from 2.4–2.6's "aborts the current stream") both name a provider primitive, and ACP `session/cancel` is one: the agent is asked to stop and answers the prompt with `StopReason.cancelled`; Archon does not tear the stream down. The executor scout argued for `'stream-abort'` because the DSH child is not kept alive; that reading conflates process lifetime with the interrupt mechanism, and `types.ts:842–845` reserves `'stream-abort'` for providers that "can only end the turn by aborting its stream" (Codex/Grok/OMP in 2.4–2.6). No downstream gate distinguishes the two values, so the choice is documentary — and the spec's word wins. `DEEPSEEK_CAPABILITIES.interrupt` becomes `'native'`; the `types.ts` docstring gains DeepSeek's ACP cancel as a second `'native'` example.
- **The abort marker must be a provider-native value, fixed by the spike.** `MessageChunk.result.terminalReason` is documented at `packages/providers/src/types.ts:351` as "forwarded verbatim from the SDK". ACP 1.4.0's `StopReason` is exactly `end_turn | max_tokens | max_turn_requests | refusal | cancelled`, and the schema states an agent MUST answer the cancelled `session/prompt` with `cancelled` (scout report §2); the spike (Phase 1 gate) records whether DSH honours that or rejects the request — today `promptResponse` is discarded on the abort path (`acp-client.ts:368–371`). Either way the provider issued the cancel itself (a transport fact, not prose inference), so `abortedResult()` stamps `terminalReason: 'cancelled'` and the executor's `INTERRUPT_TERMINAL_REASONS` set gains that one value. The set's comment at `dag-executor.ts:452–456` ("the ONLY provider terminal reasons ... the Claude SDK's two abort markers") is rewritten, not left false.
- **The executor does not read `errorSubtype:'deepseek_aborted'` or `stopReason:'aborted'`.** The Story 2.3 classifier keys on `terminalReason` only; adding a second, provider-specific field check would fork the contract. The spec's marker names are satisfied because the same result still carries them — they remain visible to other consumers (Fail-Fast: the adapter never suppresses the abort result).

## Scope

In scope:

- `interruptSignal` plumbed from `DeepseekProvider.sendQuery` into `DeepseekAcpTurnInput`, with a second listener next to the existing `abortSignal` one; either signal issues `session/cancel` exactly once and ends the turn with the abort-marked result.
- `abortedResult()` gains `terminalReason`; `DEEPSEEK_CAPABILITIES.interrupt = 'native'`.
- `INTERRUPT_TERMINAL_REASONS` in the executor gains the DeepSeek/ACP value; comment rewritten.
- A DeepSeek-shaped conformance fixture in the executor matrix (`dag-executor.test.ts` block at `:27068`) exercising direct, AI-loop, and outstanding-tool (`⚠`) cases with the exact result shape `abortedResult()` emits.
- A real-DSH spike (`spike:interrupt:deepseek`) mirroring `acp-handshake-spike.ts` env gating, with sanitized evidence in `reports/deepseek-interrupt-resume-spike.md`.
- Capability matrix regeneration, one DeepSeek docs sentence, and `sprint-status.yaml` → `done` at closeout.

Out of scope, owners preserved:

- Registry, executor state machine, interrupt route, sub-state projection, docks, Playwright e2e (Story 2.3, unchanged; the e2e-fake stays the deterministic Playwright driver).
- Codex/OMP/Grok interruption (Stories 2.4–2.6); OMP's thrown-abort path (`isAbortLikeStreamError`) is untouched.
- Mid-turn soft-inject (DSH rejects a concurrent prompt in 2 ms — `provider-steering-matrix.md:61`), the 30-minute idle expiry (Story 2.12), operator transcript rows (2.8), usage/cost for DeepSeek (still omitted in v1 per docs).
- Any change to node Cancel behaviour: Cancel still sends the same `session/cancel` + `session/close`, still yields the `isError` abort result, and still fails the node by position (`:3124` check) because the operator-interrupt flag is not set.

## Repository evidence inspected

| Area | Evidence and verified implication |
| --- | --- |
| Provider contract | `packages/providers/src/types.ts:609` `interruptSignal?: AbortSignal`; `:847` `interrupt: 'native' \| 'stream-abort' \| false`; `:351–356` `terminalReason` doc. Claude's implementation at `claude/provider.ts:1681–1961` binds the signal to `Query.interrupt()` and never retries an interrupted attempt. |
| DeepSeek provider | `community/deepseek/provider.ts:145–223` — pre-aborted `abortSignal` yields `deepseek_aborted` before preflight; forwards `abortSignal` only into `DeepseekProcessInput`; wraps `runTurn` with `withResumedOutcome`. `capabilities.ts:25` `interrupt: false`. |
| ACP client | `acp-client.ts:105–113` `abortedResult()` (`stopReason:'aborted'`, `isError:true`, `errorSubtype:'deepseek_aborted'`, no `terminalReason`); `:312–319` single `onAbort` listener → `session/cancel`; `:340–351` prompt rejection swallowed once `aborted`; `:356–366` `finally` awaits cancel, then `session/close`; `:368–371` pushes the abort result. Per-turn child spawn in `runDeepseekAcpTurn` (`:380+`). |
| Executor | `dag-executor.ts:452–465` `INTERRUPT_TERMINAL_REASONS` (Claude's two values only); `:2683–2692` direct-path `interruptMarked` = flag && `isInterruptTerminalReason(msg.terminalReason)`; `:2764–2775` interrupted break happens BEFORE the `isError` guard, so an `isError:true` abort result idles rather than fails (test `:27269` proves it for Claude's shape); loop path mirrors at `:6406–6420`; capability gate `:3196` / `:5964`. |
| Tests | Executor matrix `dag-executor.test.ts:27068–27800` hard-codes `getType: () => 'claude'` + `mockClaudeCapabilities`; the "queue-only provider" test (`:27667`) pins that a `false` capability shows no Stop. ACP fake-agent harness in `acp-client.test.ts:496–580` (abort test at `:502`). Provider `runTurn` injection in `provider.test.ts:74–110`. |
| Spike precedent | `claude/interrupt-resume-spike.ts` + `reports/claude-interrupt-resume-spike.md` (sanitized JSON evidence, `spike:interrupt:claude` script); `deepseek/acp-handshake-spike.ts` (`DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_LIVE_MODEL` gating, fresh + resume turns). |
| Resume-after-cancel precedent | Devin (`community/devin/acp-client.ts`, docs `ai-assistants.md:936`) already cancels an ACP turn and reloads the same session in a new child for AskHuman — the same shape this story relies on, but for DSH it is unproven until the spike. |
| Docs/matrix | `scripts/generate-capability-matrix.ts:70,153–157` renders the Interrupt row from `capabilities.interrupt`; `provider-capabilities.md:60` currently ❌ for DeepSeek. `ai-assistants.md:879–913` DeepSeek section has no steering sentence. |

Scout reports for this plan: `plans/reports/scout-260920-0223-deepseek-bridge-and-tests.md` and `plans/reports/scout-260920-0223-steering-gating-and-executor.md` (event-bridge tool-status mapping, provider-id gating audit, executor loop-path quotes). They are navigation aids; the claims above were checked against source directly.

## Technical decisions

### D1 — One cancel path, two signals, executor decides

`DeepseekAcpTurnInput` gains `interruptSignal?: AbortSignal`. The ACP client registers a listener on each present signal; both flip the same `aborted` flag and issue `session/cancel` once (a second abort must not send a second cancel). The provider's observable behaviour is identical for Cancel and Stop — the executor distinguishes them via `wasOperatorInterrupted(token)` and Cancel-by-position, exactly as for Claude. No provider-side "interrupted vs cancelled" distinction is invented.

### D2 — Spike-fixed abort marker

`abortedResult()` gains `terminalReason`, forwarded verbatim from the cancelled `session/prompt` response's `stopReason` when DSH resolves it (ACP mandates `'cancelled'`) and set to `'cancelled'` as the fallback when DSH rejects the request instead. The result chunk is therefore the spike's evidence; the executor set uses the string the spike records. The abort decision is frozen when the prompt request settles, so a Stop that races a natural end never stamps the marker (Phase 1 test 7). `stopReason:'aborted'`, `isError:true`, `errorSubtype:'deepseek_aborted'` are retained so the pre-existing Cancel expectations and the spec's marker names still hold.

### D3 — Executor change is one constant

`INTERRUPT_TERMINAL_REASONS` becomes a set of provider-native abort markers (Claude's two plus DeepSeek's one) with a comment that names each provider. No change to `isAbortLikeStreamError` (DeepSeek yields, it does not throw), no new field check, no provider-id branch. `deepseek_resume_failed` on the redirect turn remains a genuine node failure — the story is blocked, not downgraded, if the spike shows resume after cancel does not work.

### D4 — `⚠` tool card depends on event ordering

The executor writes `interrupted` on tool lifecycles still open when the abort-marked result arrives (`settleRunningToolsOutcome`, `:2696`). ACP 1.4.0's `ToolCallStatus` has only `pending | in_progress | completed | failed` (no `cancelled`), and the bridge maps `failed` → `tool_result` with `toolOutcome:'error'` (`event-bridge.ts:93–115`), which the executor processes before the result and deletes from `runningTools` (`dag-executor.ts:2674`). So if DSH reports the cut-off tool as `failed` after `session/cancel`, the card shows an error, not `⚠`. The spike records post-cancel event ordering; if a terminal `failed` arrives after cancel, the fix is in the bridge: the ACP client sets a `cancelRequested` flag on the shared event state when it issues the cancel, and a `failed` update seen while that flag is set maps to `toolOutcome: 'interrupted'` (already in the `MessageChunk` vocabulary, `types.ts:395`). Never in the executor.

### D5 — Conformance fixture, not a harness

Story 2.7's "DeepSeek conformance fixture" is a DeepSeek-shaped fake provider in the existing executor matrix (type `deepseek`, `DEEPSEEK_CAPABILITIES`, emitting exactly the `abortedResult()` shape) run on the direct path, the AI-loop path, and the outstanding-tool case. A small per-provider fixture table (`claude`, `deepseek`) is acceptable inside that describe block; a generic conformance framework is not built for two providers.

## Phases

| # | Phase | Depends on |
| --- | --- | --- |
| 1 | [DeepSeek ACP interrupt seam and real-DSH gate](./phase-01-deepseek-acp-interrupt-seam.md) | — |
| 2 | [Executor marker and DeepSeek conformance fixture](./phase-02-executor-marker-and-conformance-fixture.md) | 1 |
| 3 | [Capability matrix, docs, and closeout](./phase-03-matrix-docs-and-closeout.md) | 1–2 |

Deep mode: Phase 1 is planned in full; Phases 2–3 are outlined with their file inventory and test matrix and get a dedicated scout pass before execution (the spike outcome fixes the marker string and whether Phase 1 needs the event-bridge mapping).

## Acceptance criteria

- [ ] `Stop` on a live DeepSeek node sends ACP `session/cancel` once via the fresh per-turn `interruptSignal`; the node stays `running`; `steeringSubState` projects `idle-after-interrupt`.
- [ ] The abort-marked DeepSeek result (`terminalReason` set, `isError:true`, `errorSubtype:'deepseek_aborted'`) is classified as an interrupted end with the operator flag set — no `node_failed`, no validation/re-ask, one `interrupted` status row — and as the existing Cancel failure without it.
- [ ] `Send now` runs the next turn as a fresh DSH child with `session/resume` on the same session id, draining earlier receipts then the new message in order.
- [ ] Direct and AI-loop paths pass the DeepSeek conformance fixture; an outstanding tool at interrupt settles `interrupted` (`⚠`).
- [ ] Real-DSH spike evidence (sanitized) shows cancel → abort result with session id → resume → completed continuation, and records post-cancel event ordering.
- [ ] Capability matrix shows DeepSeek `native`; `bun run check:capability-matrix`, focused tests, and `bun run validate` pass; `sprint-status.yaml` moved to `done` last.

## Compatibility, operations, and rollback

- All changes are additive: an optional input field, an optional result field, one capability flip, one set entry. No migration, schema, route, or UI change.
- Calls without `interruptSignal` and the Cancel path remain byte-for-byte except for the added `terminalReason` on the abort result (update the Cancel test expectation deliberately).
- A DSH child that ignores `session/cancel` is bounded by the existing `session/close` + `reapChild` SIGTERM/SIGKILL grace (`acp-client.ts:230–250`); no new timer.
- Rollback: revert the capability flip (Stop disappears, DeepSeek returns to queue-only), then the provider/executor edits. No data rollback.

## Validation sequence

```bash
cd packages/providers && bun test src/community/deepseek/acp-client.test.ts src/community/deepseek/provider.test.ts src/registry.test.ts src/observability.test.ts
cd packages/workflows && bun test src/dag-executor.test.ts -t 'interrupt'
bun run generate:capability-matrix && bun run check:capability-matrix
cd packages/providers && DEEPSEEK_API_KEY=… DEEPSEEK_BASE_URL=… DEEPSEEK_LIVE_MODEL=… bun run spike:interrupt:deepseek   # operator-run gate, not CI
bun run validate
```

Do not run root `bun test`. Do not mark `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` done until the final gate and evidence are recorded.

## Review

Deep mode's red-team and validation gates ran as the advisor review the invocation named (non-interactive run; the Story 2.3 plan followed the same convention). Findings applied: provider-side natural-end race (Phase 1 test 7 + step 2), observable cancelled `stopReason` (D2 / Phase 1 step 3), and this note. Task hydration: no task-management surface is available in this session; progress is kept in the phase files.

## Unresolved questions

- Whether DSH resolves the cancelled `session/prompt` with `stopReason:'cancelled'` or rejects it, and whether `session/resume` after cancel + close restores the partial turn ("partial retained") — both are Phase 1 spike outputs, not planning assumptions.
- Whether DSH emits a terminal `tool_call_update` after cancel (decides D4's bridge mapping).
