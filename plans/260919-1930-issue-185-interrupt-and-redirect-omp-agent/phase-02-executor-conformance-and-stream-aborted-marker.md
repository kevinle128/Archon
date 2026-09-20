---
phase: 2
title: 'Executor conformance and the stream_aborted marker'
status: pending
priority: P1
effort: '0.5d'
dependencies: [1]
---

# Phase 2: Executor conformance and the `stream_aborted` marker

## Goal

Teach the executor's five-case classification to recognise the provider-neutral `stream_aborted` marker, then prove with an OMP-shaped fixture that the direct AI path, the AI-loop path, and a provider-calling loop-group body all interrupt, idle, and redirect on the same session — and that a thrown `Query aborted` with the operator flag set still idles (the story's literal Given/Then).

This phase is outlined (deep mode). **Scout pass before execution:** re-locate the anchors below in `packages/workflows/src/dag-executor.ts` and `dag-executor.test.ts` by their text, not line numbers, and update this file with deltas before writing tests.

## Context links

- Phase 1 contract: `terminalReason: 'stream_aborted'` on one result, then return; `STREAM_ABORTED_TERMINAL_REASON` exported from `@archon/providers/types`.
- `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` §"Engine — the per-node turn loop" and §"Providers — interrupt conformance" (omp row).
- #183 matrix: `dag-executor.test.ts` `describe('executeDagWorkflow -- interrupt and redirect (#183)')`.

## Key insights

- The executor never branches on `'native'` vs `'stream-abort'`; both gates are `getProviderCapabilities(provider).interrupt !== false` (text anchors: "The interrupt-capable face of the handle (#183)" in both `executeAiNode`-equivalent and `executeLoopNode`). No gate change is needed.
- Case 2 (abort-marked result) is decided by `isInterruptTerminalReason(msg.terminalReason)` in both paths; adding one string to `INTERRUPT_TERMINAL_REASONS` is the entire executor change.
- The test file already calls `registerOmpProvider()` at module load, so `getProviderCapabilities('omp')` returns the real, now-`'stream-abort'` constant while `deps.getAgentProvider` stays mocked — no SDK or binary is touched.
- `invokeDag` in the #183 matrix accepts `assistant: 'claude' | 'pi'` and builds a config with `assistants: { ...minimalConfig.assistants, pi: {} }`; OMP needs the same treatment (`omp: {}`), and `mockGetAgentProviderDag` must return `getType: () => 'omp'` for those cases.

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/workflows/src/dag-executor.ts` | modify | ~6 lines (marker set + docstring) | whole #183 matrix must stay green |
| `packages/workflows/src/dag-executor.test.ts` | modify | ~200 lines (helper widening + 6 fixtures) | new OMP conformance scenarios |

## Dependency map

- Depends on Phase 1 (constant + marker string).
- Feeds Phase 3 (the "conformance evidence" the sprint-status close cites).

## Implementation contract

- `INTERRUPT_TERMINAL_REASONS` (anchor: "The ONLY provider terminal reasons that classify a result as an operator interrupt") becomes `new Set(['aborted_streaming', 'aborted_tools', STREAM_ABORTED_TERMINAL_REASON])`, imported from `@archon/providers/types`. Rewrite the docstring: two Claude SDK markers plus the provider-neutral marker a `stream-abort` provider sets from its own interrupt signal. Keep "no prefix or prose matching".
- `isAbortLikeStreamError` is unchanged; `Query aborted` stays recognised.
- No other executor edits. If the scout pass finds any `'native'` comparison outside tests, stop and record it — the plan's no-server/no-web claim would be wrong.

## Test scenario matrix

| Priority | Scenario | Path | Asserts |
| --- | --- | --- | --- |
| Critical | OMP-shaped interrupt: fixture yields `session`-less assistant chunk(s), a `tool` chunk, then on `interruptSignal` abort yields `{ type: 'result', sessionId: 'omp-1', terminalReason: 'stream_aborted' }` and returns | direct | `awaitIdle` reaches `idle-after-interrupt`; tool settles `interrupted` once; one `interrupted` status row; no `node_failed`; `sendNow` → second call's `resumeSessionId === 'omp-1'`; `node_completed` |
| Critical | Same fixture | AI loop (`loop:`) | idles inside the iteration; `Send now` resumes the interrupted iteration on `omp-1` before the completion check; iteration count not consumed |
| Critical | Same fixture | loop-group body (`loop_group:` with a `prompt` body node) | parks under the namespaced step name; same-session resume |
| High | Story literal: fixture throws `new Error('Query aborted')` after `result { sessionId }` with the flag set | direct | classified interrupted (case 3), no `node_failed`, resume on the same id |
| High | Story literal, first turn, throw with **no** prior result | direct | explicit failure text "returned no session id to resume" — pins D3 and documents why the provider is result-shaped |
| High | `stream_aborted` result with **no** `sessionId`, first iteration | AI loop | the loop path's own copy of the safety net fires ("Loop node … was interrupted but the provider turn returned no session id") and the iteration fails explicitly; queued guidance is not silently dropped (red team F4) |
| High | `stream_aborted` result with `resumed: false` on a redirect turn | direct | the existing resume-fallback warning is emitted and the node still idles on the observed id (pins the A3 contract end to end) |
| High | `stream_aborted` result **without** the operator flag (provider emitted the marker but nobody pressed Stop) | direct | treated as natural end (case 1): validation runs, node completes or fails on its own merits, no idle |
| Medium | `stream_aborted` result carrying `isError: true` | direct | marker wins, idles (mirrors the existing Claude "marker wins over isError" case) |
| Medium | Capability pin: `provider: 'omp'` node observes a defined `interruptSignal` and `steeringSubState === 'generating'` inside `sendQuery` | direct | proves the capability flip alone made the handle interruptible |

## Tests before

- Run the existing #183 matrix (`bun test src/dag-executor.test.ts -t 'interrupt and redirect'`) and record the count; it must not change except for additions.
- Add the "marker without flag → natural end" scenario **first** against the unchanged executor; it passes today (unknown marker = natural) and must still pass after the marker is added — it is the guard against over-classification.

## Refactor

- Widen `invokeDag`'s `assistant` option to `'claude' | 'pi' | 'omp'` and extend the config branch; add `getType: () => 'omp'` where the OMP fixtures install their mock provider. Do not parameterise the 19 Claude scenarios into a shared helper in this story; Stories 2.4/2.6/2.7 will show whether that abstraction earns its keep (rule of three).

## Tests after

- The Critical/High/Medium rows above, each with a `sessionId` assertion on the resume call (`sendQueryArg(1, 2)`).

## Todo

- [ ] Scout pass: confirm anchors, `invokeDag` shape, and that `registerOmpProvider()` is still called at module load.
- [ ] Tests before: baseline count; marker-without-flag scenario.
- [ ] Tests after: write all matrix rows, confirm they fail for the right reason (unknown marker → natural end → validation → no idle).
- [ ] Add `STREAM_ABORTED_TERMINAL_REASON` to the marker set; fix the docstring.
- [ ] Full file green; `bun run type-check` for `@archon/workflows`.

## Regression gate

```bash
cd packages/workflows
bun test src/dag-executor.test.ts -t 'interrupt and redirect'
bun test src/dag-executor.test.ts
bun test src/steering-registry.test.ts
bun run type-check
```

## Success criteria

- Every matrix row green; no existing scenario changed.
- The executor diff is the marker set and its docstring only.

## Risk assessment

- **Over-classification:** a provider that emits `stream_aborted` without an operator Stop must still be a natural end — pinned by the "without flag" row.
- **Loop-path drift:** the loop path has its own copy of the classification; the loop rows exist so both copies are exercised.

## Next steps

Phase 3 regenerates docs and closes the story.
