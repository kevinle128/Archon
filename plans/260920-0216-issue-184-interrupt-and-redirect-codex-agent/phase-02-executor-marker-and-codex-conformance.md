---
phase: 2
title: 'Executor marker and Codex conformance fixtures'
status: pending
priority: P1
effort: '0.5d'
dependencies: [1]
---

# Phase 2: Executor marker and Codex conformance fixtures

## Goal

Teach the executor's five-case classification the stream-abort marker and prove, with Codex-shaped fixtures in the existing #183 matrix, that direct AI nodes, AI loop nodes, and provider-calling loop-group bodies interrupt and redirect a Codex agent with exactly the same transcript order, status rows, sub-state projection, and node state as Claude.

Deep-mode note: scout this phase again after Phase 1 lands — the spike may narrow which terminal shapes the fixtures must pin (see `reports/codex-interrupt-resume-spike.md`), and Phase 1 may have moved line numbers cited here.

## Files

| File | Change |
| --- | --- |
| `packages/workflows/src/dag-executor.ts` | `INTERRUPT_TERMINAL_REASONS` (`:457-460`) gains `STREAM_ABORT_TERMINAL_REASON` imported from `@archon/providers/types`; comment updated to name both marker families. No other executor change is expected — `isAbortLikeStreamError` already accepts `'Query aborted'` (`:474-484`); the fail-fast at `:3488-3496` and the loop counterpart at `:7065-7102` stay as they are. |
| `packages/workflows/src/dag-executor.test.ts` | New `describe('executeDagWorkflow -- Codex interrupt conformance (#184)')` reusing the #183 harness helpers (`liveHandle`, `awaitIdle`, `enqueue`, `sendNow`, `transcriptStates`, `storedEventTypes`, `sendQueryArg`) with the provider pinned to `getType: () => 'codex'`. Also add `interrupt: 'stream-abort' as const` to `mockCodexCapabilities` (`:318-334`) **for fixture consistency only** — it is not the gate: the executor reads `getProviderCapabilities(provider)` from the real, unmocked registry (`dag-executor.ts:3196`, `:5964`; `registry.ts:84`; the file mocks only `@archon/paths`), so Phase 1's `capabilities.ts` flip is what makes these tests reachable. |
| `packages/workflows/src/steering-registry.test.ts` | Only if `capability-aware registration` (`:610`) enumerates provider values — add a `'stream-abort'` case proving the handle registers `interruptible: true`. |

## Conformance fixture design

Write one provider-parametrized helper so the executor's provider-agnostic classification is asserted literally rather than by eye. Be precise about what this proves: both fixtures feed hand-authored, structurally identical chunk sequences, so a deep-equal capture proves the **executor path is provider-agnostic**, not that real Codex SDK behaviour matches Claude — that evidence lives solely in the Phase 1 spike report.

```ts
const INTERRUPT_FIXTURES = [
  { provider: 'claude', caps: mockClaudeCapabilities, marker: 'aborted_streaming' },
  { provider: 'codex',  caps: mockCodexCapabilities,  marker: 'stream_aborted' },
] as const;
```

For each fixture the `sendQuery` mock yields `assistant('partial')` → `tool(toolCallId:'call-1')` → abort-marked `result(sessionId:'sess-1', terminalReason: marker)` on call 1, and `assistant('redirected')` → `result(sessionId:'sess-2')` on call 2. Capture for each fixture: the ordered transcript rows (kind + status/outcome), `storedEventTypes`, the sequence of `handle.steeringSubState()` observed at three probes (during call 1, while idle, during call 2), the `resumeSessionId` and `forkSession` passed to call 2, and the run's terminal status. Assert the Codex capture **deep-equals** the Claude capture after normalizing the marker string.

## Tests first

`packages/workflows/src/dag-executor.test.ts`, new describe block:

| # | Test | Path | Asserts |
| --- | --- | --- | --- |
| 1 | `Codex abort-marked result parks in idle and Send now resumes the same thread` (parametrized over `INTERRUPT_FIXTURES`) | direct | Interrupt outcome `idle-after-interrupt`; exactly one `interrupted` status row; no `node_failed`; call 2 `resumeSessionId === 'sess-1'`, `forkSession === false`, prompt `'old note one\n\nold note two\n\nnew instruction'`; capture deep-equals Claude's. |
| 2 | `Codex interrupted tool row settles interrupted (⚠ source) and a completed one is untouched` | direct | `tool` chunk with `toolCallId:'call-1'` left open + marker result → stored `tool_result` for `call-1` has `toolOutcome: 'interrupted'`; a `call-0` resolved before Stop keeps `success`; one status row. Mirrors `:27502`. |
| 3 | *(removed)* A `'Query aborted'` throw on a pure operator interrupt has no producing path in the Phase 1 contract (that string is node-Cancel only); the executor's case-3 tolerance is already covered provider-agnostically at `:27300`. Do not add a Codex copy of a shape the provider cannot emit. |
| 4 | `Codex crash-shaped throw racing Stop stays a real failure` | direct | `Error('Codex crash: Codex Exec exited with code 1')` with the flag set → `node_failed`, no idle, handle unregistered. Executor case 4. |
| 5 | `Codex natural turn.completed racing Stop drains queued guidance and settles generating` | direct | Unmarked result after `interrupt()` with one queued message → `interrupt()` resolves `'generating'`, second call carries the queued message. Mirrors `:27363`. |
| 6 | `Codex interrupt on a fresh thread with no session id fails explicitly` | direct | Marker result with `sessionId: undefined` → run fails with the "returned no session id to resume" message; queued guidance not silently dropped into a fresh thread. Mirrors `:27615`; documents the pre-`thread.started` window. |
| 7 | `Codex interrupt in an AI loop idles inside the iteration and Send now resumes without consuming one` | loop | Mirrors `:27698` with the Codex marker; iteration count unchanged by the redirect. |
| 8 | `Codex interrupt of a loop-group body node parks under the namespaced step name` | loop_group | Mirrors `:27781`; handle key `<group>__<node>`. |
| 9 | `Codex sub-state projection is generating → idle-after-interrupt → generating` | direct | Probe `steeringSubState()` at the three points; `interrupting` never appears. |
| 10 | `Codex late interrupt after endTurnStream cannot flip a natural completion` (parametrized) | direct | The mock yields a natural unmarked result, and `handle.interrupt()` is called from a `finally`-like point after the stream pump finished (post-`endTurnStream`, pre-`settleTurn`). `wasOperatorInterrupted` is true (`steering-registry.ts:235-249` sets it unconditionally) yet the turn ends naturally — proves the terminal-reason marker gate (`dag-executor.ts:2686-2696`) is what guards classification, for both marker families. **Scout note:** the post-`endTurnStream` window may not be reachable from the DAG harness (the mock generator cannot hook the executor's `finally`; `:27363` calls `interrupt()` inside the generator). If so, assert the invariant in `steering-registry.test.ts` instead: `interrupt()` after `endTurnStream` → flag true, controller undefined, and a subsequent `settleTurn('generating')` wins. The invariant matters, not the exact window. |

Run: `cd packages/workflows && bun test src/dag-executor.test.ts -t 'Codex'` first, then the whole file, then `bun test src/steering-registry.test.ts`.

## Steps

1. Scout: re-read the #183 describe block and confirm helper names/line anchors after Phase 1.
2. Add `interrupt: 'stream-abort'` to `mockCodexCapabilities` (consistency); write tests 1–10 red (test 1 fails today because `'stream_aborted'` is not in `INTERRUPT_TERMINAL_REASONS`, so the marker result falls through as a natural end).
3. Import the constant and add it to the set; green the tests.
4. Run the full `dag-executor.test.ts` and `steering-registry.test.ts`; `bun run type-check`.

## Verification

```bash
cd packages/workflows && bun test src/dag-executor.test.ts -t 'Codex'
cd packages/workflows && bun test src/dag-executor.test.ts
cd packages/workflows && bun test src/steering-registry.test.ts
bun run type-check && bun run lint
```

## Risks

- If Phase 1's spike shows Codex emits `turn.failed` with usage or a partial `turn.completed` on kill, add a fixture for that exact shape; do not guess shapes not observed.
- The executor file is very large; keep the change to the constant set so line-anchored #183 tests do not shift.
