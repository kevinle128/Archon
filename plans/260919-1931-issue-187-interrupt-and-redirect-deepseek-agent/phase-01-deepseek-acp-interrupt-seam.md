---
phase: 1
title: 'DeepSeek ACP interrupt seam and real-DSH gate'
status: pending
priority: P1
effort: '1d'
dependencies: []
---

# Phase 1: DeepSeek ACP interrupt seam and real-DSH gate

## Goal

Give the DeepSeek provider a turn-scoped `interruptSignal` that issues ACP `session/cancel` exactly once, ends the turn with an abort-marked result that carries a provider-native `terminalReason`, and leaves the ACP session id resumable. Prove cancel → resume → continuation against real DSH before Phase 2 relies on the marker. Calls without `interruptSignal` keep the existing prompt/abort path.

## Context links

- Story 2.7: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:614–638`
- Spec: `_bmad-output/specs/spec-agent-node-room/engine-integration.md:33`, `steering-test-plan.md:41`, `provider-steering-matrix.md:59–63`
- Claude precedent: `packages/providers/src/claude/provider.ts:1681–1961`, `packages/providers/src/claude/interrupt-resume-spike.ts`, `reports/claude-interrupt-resume-spike.md`
- Scout: `plans/reports/scout-260920-0223-deepseek-bridge-and-tests.md`

## Key insights

- `acp-client.ts:312–319` has one `onAbort` listener for `abortSignal`; `:340–351` swallows the prompt rejection once `aborted`; `:356–366` `finally` awaits the cancel notify and then always sends `session/close`; `:368–371` pushes `abortedResult(sessionId)`.
- `abortedResult()` (`:105–113`) has `stopReason:'aborted'`, `isError:true`, `errorSubtype:'deepseek_aborted'` and **no** `terminalReason` — so today the executor's `isInterruptTerminalReason()` cannot recognise it.
- The executor breaks out of the stream on `interruptMarked` **before** the `isError` guard (`dag-executor.ts:2764–2775`), so keeping `isError:true` on the abort result is safe (proved for Claude's shape at `dag-executor.test.ts:27269`).
- Every turn is its own DSH child (`runDeepseekAcpTurn`); "same session" is `session/resume` with the retained id (`:290–300`). Resume after cancel + close is unproven for DSH — the spike gate below.
- `provider.ts:145–223` forwards only `abortSignal`; `DeepseekProvider.sendQuery` pre-aborted check is for `abortSignal` only. The executor mints a fresh interrupt controller per pass (`dag-executor.ts:2431–2435`), so `interruptSignal` is never pre-aborted in practice; mirror the check anyway for symmetry only if it costs one line (KISS).

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/providers/src/community/deepseek/acp-client.ts` | modify | ~25 lines | `acp-client.test.ts` abort test `:502` expectation gains `terminalReason` |
| `packages/providers/src/community/deepseek/provider.ts` | modify | ~3 lines | `provider.test.ts` forwarding assertion |
| `packages/providers/src/types.ts` | modify | docstring at `:838–847` — add DeepSeek ACP `session/cancel` as a second `'native'` example | — |
| `packages/providers/src/community/deepseek/capabilities.ts` | modify | 1 line | `config.test.ts:124–146` (`toEqual` literal with `interrupt:false`) and `registry.test.ts:197–204` (`'only Claude advertises native interrupt'` → `['claude','deepseek']`) must be updated; `observability.test.ts`/`loader.test.ts` pin nothing |
| `packages/providers/src/community/deepseek/event-bridge.ts` | modify only if the spike shows a `failed` tool update after cancel | ~10 lines (`cancelRequested` on event state; `failed` while set → `toolOutcome:'interrupted'`) | `event-bridge.test.ts` |
| `packages/providers/src/community/deepseek/acp-client.test.ts` | modify | +5 tests, `closeHold` option on `createFakeDsh` | — |
| `packages/providers/src/community/deepseek/provider.test.ts` | modify | +2 tests | — |
| `packages/providers/src/community/deepseek/interrupt-resume-spike.ts` | create | ~150 lines | diagnostic only, not in the `test` script |
| `packages/providers/package.json` | modify | 1 script `spike:interrupt:deepseek` | — |
| `reports/deepseek-interrupt-resume-spike.md` | create | sanitized evidence | — |

## Tests before (regression, written first)

Run: `cd packages/providers && bun test src/community/deepseek/acp-client.test.ts src/community/deepseek/provider.test.ts`

1. `acp-client.test.ts` — extend `'aborting during prompt sends cancel, closes the session, and emits local aborted result'` (`:502`) to assert the abort result **also** carries `terminalReason` (fails until step 3). Keep every existing assertion (cancel called, close called, `errorSubtype:'deepseek_aborted'`, `isError:true`).
2. `acp-client.test.ts` — new: `'interruptSignal abort sends one session/cancel, closes the session, and emits the abort-marked result with the session id'` using the fake ACP agent harness (`FakeAgent`/`methodsCalled()` pattern from `:496–580`).
3. `acp-client.test.ts` — new: `'both signals aborting sends session/cancel exactly once'`.
4. `acp-client.test.ts` — new: `'consumer early return still sends cancel for a live session when interruptSignal was never aborted'` (guards the existing `finally` at `:388–398`).
5. `provider.test.ts` — new: `'forwards interruptSignal into DeepseekProcessInput alongside abortSignal'` via `DeepseekProviderDependencies.runTurn` injection (pattern at `:74–110`).
6. `provider.test.ts` — new: `'getCapabilities reports interrupt native'`.
7. `acp-client.test.ts` — new: `'interruptSignal aborting after the prompt resolved yields the natural result, not the abort-marked one'` — hold `session/close` open with the fake harness's `closeHold` deferred (add it to `createFakeDsh` options like `promptHold`), abort the interrupt signal while close is pending, and assert the result is the natural `successResult` (real `stopReason`, structured output kept) and that **no** `session/cancel` was sent. This is the provider-side half of the executor's case 1 ("a result without an abort marker is a natural end even when Stop raced it") — Claude gets it from the SDK; DeepSeek must enforce it.

## Implementation steps

1. `acp-client.ts`: add `interruptSignal?: AbortSignal` to `DeepseekAcpTurnInput`. In `driveDeepseekAcpTurn`, register a shared `requestCancel()` on both signals; guard so `session/cancel` is notified once (`if (aborted) return; aborted = true; cancelSent = …`). Compute the initial `aborted` from either signal.
2. `acp-client.ts`: freeze the abort decision the moment the `session/prompt` request settles — remove both listeners immediately after `promptResponse` resolves/rejects (before the `finally` awaits cancel and `session/close`), so a signal that fires during teardown cannot stamp the abort marker on a naturally finished turn or send a cancel for a closed prompt (test 7).
3. `acp-client.ts`: `abortedResult(sessionId, stopReason)` — forward `promptResponse?.stopReason` verbatim when DSH resolved the cancelled request (ACP mandates `'cancelled'`), and use `'cancelled'` only as the fallback when it rejected; emit it as `terminalReason`. Keep `stopReason:'aborted'`, `isError:true`, `errorSubtype:'deepseek_aborted'`. This makes the result chunk itself the spike's evidence of what DSH returned. Add a short comment naming `terminalReason` as the executor's classification marker (#183 five-case rule).
4. `provider.ts`: forward `requestOptions?.interruptSignal` into `DeepseekProcessInput`.
5. `capabilities.ts`: `interrupt: 'native', // ACP session/cancel + session/resume on the same id (cancel-and-continue)`.
6. Update the two pinned fixtures: `config.test.ts:144` expected literal → `'native'`; `registry.test.ts:197–204` expected native list → `['claude', 'deepseek']`.
7. Create `interrupt-resume-spike.ts` (see gate). Add `spike:interrupt:deepseek` to `packages/providers/package.json` next to `spike:deepseek:acp`; do not export from the barrel.
8. Run the spike with operator credentials; write `reports/deepseek-interrupt-resume-spike.md` (command, DSH pin `@deepseek-ai/dsh@0.1.2-rc.1`, ACP SDK pin `1.4.0`, event ordering, prompt-response outcome, session-id equality, continuation result; no prompts, credentials, or model content).
9. If the spike shows a `tool_call_update` with `status:'failed'` after cancel (ACP has no `cancelled` tool status), add `cancelRequested` to `createDeepseekEventState()`, set it in `requestCancel()`, and map `failed`-while-cancelRequested to `toolOutcome: 'interrupted'` in `event-bridge.ts` (D4), with a bridge test proving `failed` without the flag still maps to `'error'`.

## Refactor (protected changes)

- The single `onAbort` closure becomes a shared `requestCancel()` invoked by both listeners; no other control flow in `driveDeepseekAcpTurn` moves. The `finally` ordering (await cancel → `session/close` → `sessionLive=false`) is unchanged.

## Tests after (new behaviour)

- Tests 2–7 above pass; test 1 passes with the new field.
- `event-bridge.test.ts` case for the post-cancel `failed` status only if step 9 applies.

## Real-DSH gate (diagnostic, operator-run)

Script `packages/providers/src/community/deepseek/interrupt-resume-spike.ts`, gated on `DEEPSEEK_LIVE_TEST=1` plus `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_LIVE_MODEL` exactly like `acp-handshake-spike.ts` (`:43–53`, `:93–99`), in a disposable temp cwd, emitting a sanitized JSON evidence document like the Claude spike (session ids and chunk-type names only):

1. Fresh session: send a prompt that produces a multi-step tool-using turn; on the first `assistant` or tool chunk, abort an `interruptSignal`. Record: chunk types after the abort, whether a `tool_call_update` with `completed`/`failed` arrived for the in-flight tool, whether `session/prompt` resolved or rejected — observable directly from the abort result's `terminalReason` (step 3 forwards the resolved `stopReason` and falls back to `'cancelled'` on rejection; the spike additionally logs which branch fired via the provider's existing structured logger at debug level), the abort result's `sessionId`, `terminalReason`, and timing.
2. Resumed session: `resumeSessionId = <that id>`, send a short redirect prompt; record `resumed === true`, that the turn completes with a non-error result, and (best effort) whether the reply references the cut-off work ("partial retained").
3. Interrupt the resumed session again and resume a third time to prove repeatability.

Gate outcomes:

- **Proceed:** abort result carries the session id; resume after cancel + close succeeds and the continuation completes.
- **Block:** `session/resume` fails after a cancelled turn (`deepseek_resume_failed`), or the session id is not retained. Record evidence, stop, and report the blocker on issue #187; do not fall back to a fresh session or to node Cancel.

## Regression gate

```bash
cd packages/providers && bun test src/community/deepseek/acp-client.test.ts src/community/deepseek/provider.test.ts src/community/deepseek/event-bridge.test.ts src/registry.test.ts src/observability.test.ts
bun run type-check
```

## Todo

- [ ] Tests before (1–6) written and failing for the right reason
- [ ] Steps 1–5 implemented; tests green
- [ ] Spike script + package script added
- [ ] Spike run; sanitized report written; marker string confirmed or adjusted
- [ ] Event-bridge mapping decided from spike evidence
- [ ] Regression gate green

## Success criteria

- A DeepSeek turn with an aborted `interruptSignal` ends with one `session/cancel`, one `session/close`, and an abort-marked result carrying the session id and `terminalReason`; the same turn without any signal is unchanged.
- The spike report exists and records a "proceed" outcome.

## Risk assessment

- **Resume after cancel unsupported by DSH** — blocker by design (see gate); Devin's ACP cancel-then-reload precedent makes it plausible but not proven.
- **Tool card closes before the result** — handled by D4/step 8.
- **Double cancel on Cancel+Stop race** — the once-guard in step 1; test 3.

## Security considerations

No new credentials or env vars; the spike reuses the existing DeepSeek env contract and its report is sanitized like the Claude one.
