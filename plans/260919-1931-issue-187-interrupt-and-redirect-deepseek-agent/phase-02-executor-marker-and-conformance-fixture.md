---
phase: 2
title: 'Executor marker and DeepSeek conformance fixture'
status: pending
priority: P1
effort: '0.5d'
dependencies: [1]
---

# Phase 2: Executor marker and DeepSeek conformance fixture

## Goal

Make the executor's five-case classifier recognise DeepSeek's abort-marked result on both the direct and AI-loop paths, and prove it with a DeepSeek-shaped conformance fixture in the existing interrupt matrix — without touching the registry, idle-await, route, or docks.

Deep mode: outline only; run a scout pass on `dag-executor.ts:2683–2700`, `:6406–6420` and the test block at `dag-executor.test.ts:27068+` before executing, and read the Phase 1 spike report first — its recorded `terminalReason` value is the string used here.

## Context links

- `packages/workflows/src/dag-executor.ts:452–465` (`INTERRUPT_TERMINAL_REASONS`, `isInterruptTerminalReason`), `:2683–2775` (direct path), `:6406–6420` (loop path), `:3477–3510` / `:7060–7100` (idle entry)
- `packages/workflows/src/dag-executor.test.ts:27068–27800` (Story 2.3 matrix; `mockClaudeCapabilities`, `mockGetAgentProviderDag`, `liveHandle`, `awaitIdle`, `sendNow`)
- Scout: `plans/reports/scout-260920-0223-steering-gating-and-executor.md`

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/workflows/src/dag-executor.ts` | modify | ~6 lines (set entry + comment) | none beyond the new fixture |
| `packages/workflows/src/dag-executor.test.ts` | modify | +5 tests in the `#183` block | — |

## Tests before (written first, failing)

Run: `cd packages/workflows && bun test src/dag-executor.test.ts -t 'deepseek'`

Harness prerequisites (scout report §3): `dag-executor.test.ts:71–90` bootstraps the registry with `registerBuiltinProviders()` + OMP/OpenCode/Pi/Devin/Qoder, but never `registerDeepseekProvider()` — `getProviderCapabilities('deepseek')` (`dag-executor.ts:3196`, a real registry lookup, not the mocked `getCapabilities`) throws `UnknownProviderError` today. Add `registerDeepseekProvider` to that import/bootstrap block. `invokeDag` (`:27176–27207`) accepts `assistant?: 'claude' | 'pi'` and builds `minimalConfig` per assistant; extend it with `'deepseek'` → `{ ...minimalConfig, assistant: 'deepseek', assistants: { ...minimalConfig.assistants, deepseek: {} } }`.

Add a `deepseekFixture` next to the existing Claude mocks: `getType: () => 'deepseek'`, `getCapabilities: () => DEEPSEEK_CAPABILITIES` (import from `@archon/providers`), and a helper `deepseekAbortResult(sessionId)` returning exactly `{ type: 'result', sessionId, stopReason: 'aborted', isError: true, errorSubtype: 'deepseek_aborted', terminalReason: <spike value> }`. Point `mockGetAgentProviderDag` at the fixture in a nested `describe('deepseek conformance')` `beforeEach`, restoring the Claude mock in `afterEach` as the outer block already does.

1. `'deepseek: interrupt parks the abort-marked result in idle and Send now resumes on the same session'` — direct path; assert `sendQuery` call 2 receives `resumeSessionId === 'sess-1'` (the executor sets `turnResumeId = newSessionId ?? turnResumeId` at `dag-executor.ts:3488`, so the abort result MUST carry `sessionId`), `storedEventTypes` has no `node_failed`, has `node_completed`, and exactly one `interrupted` status row.
2. `'deepseek: the same abort result without the operator flag keeps the existing Cancel/SDK-error failure'` — no `interrupt()` call, result yielded as-is → `node_failed` with `SDK returned deepseek_aborted` (locks the Cancel path).
3. `'deepseek: interrupt in an AI loop idles inside the iteration and Send now resumes without consuming one'` — mirror `:27698` (`{ id, loop: { prompt, until, max_iterations } }`, `transcriptStates` contains `'interrupted'`, call 2 `resumeSessionId === 'loop-sess-1'`) with the DeepSeek shape; loop path resumes `settledTurnSessionId ?? currentSessionId` (`:7060+`).
4. `'deepseek: an outstanding tool at interrupt settles interrupted — one status row'` — mirror `:27502` with the bridge's chunk shapes (`{ type:'tool', toolName, toolCallId, toolInput }` / `{ type:'tool_result', toolName, toolCallId, toolOutput, toolOutcome }`, `event-bridge.ts:77–115`); include a second variant where the bridge emitted `toolOutcome:'interrupted'` itself (Phase 1 step 8) and assert no duplicate status row.
5. `'deepseek: interrupt skips structured-output validation and the re-ask'` — `output_format` node, abort result with no `structuredOutput` → idle, no `validation_miss`/re-ask.

## Implementation steps

1. `dag-executor.ts`: add the DeepSeek marker to `INTERRUPT_TERMINAL_REASONS`; rewrite the comment to "provider-native abort markers, one entry per interrupt-capable provider: Claude `aborted_streaming`/`aborted_tools`, DeepSeek/ACP `<value>`". No prefix matching.
2. Run the five tests; they pass with no other executor change. If any fails on the loop path, the scout pass identifies the divergence — do not add a provider-id branch.

## Refactor (protected)

None planned. The classifier stays a single `Set` lookup gated by `wasOperatorInterrupted(token)`.

## Tests after

- The five DeepSeek tests plus the existing 19 Story 2.3 scenarios pass unchanged.

## Test scenario matrix

| Path | Critical | High | Medium |
| --- | --- | --- | --- |
| Direct | interrupted → idle → send_now same session | Cancel path unchanged (`isError` failure) | structured-output skip |
| AI loop | interrupted iteration resumes without consuming one | — | — |
| Tools | outstanding tool → `interrupted`, one status row | — | — |

## Regression gate

```bash
cd packages/workflows && bun test src/dag-executor.test.ts -t 'interrupt'
cd packages/workflows && bun test src/steering-registry.test.ts
bun run type-check
```

## Todo

- [ ] Scout pass on the three executor sites and the matrix block
- [ ] Fixture + five tests written and failing
- [ ] Set entry + comment; tests green
- [ ] Regression gate green

## Success criteria

Both execution paths classify the DeepSeek abort result as interrupted with the flag set and as a failure without it; no `node_failed` on the interrupted path.

## Risk assessment

- The loop path uses `turnToken` rather than `passTurn.token`; the scout pass confirms both sites read `msg.terminalReason` identically before tests are written.
- If the spike changed the marker string, this phase uses the recorded value; a mismatch here is the only way Phase 1 and 2 can drift — check the report first.
