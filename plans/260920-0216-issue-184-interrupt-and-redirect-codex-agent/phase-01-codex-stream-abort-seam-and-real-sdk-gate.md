---
phase: 1
title: 'Codex stream-abort seam and real-SDK gate'
status: pending
priority: P1
effort: '1d'
dependencies: []
---

# Phase 1: Codex stream-abort seam and real-SDK gate

## Goal

Make the Codex provider honour the turn-scoped `interruptSignal` by aborting its own per-attempt stream and ending with a normalized abort-marked `result` that carries the thread id — without touching node-Cancel behaviour, without a cold retry, and only after a real-SDK spike proves the pinned `@openai/codex-sdk` lets a killed turn be resumed on the same thread.

The capability flip (`interrupt: 'stream-abort'`) ships **in this phase together with the seam**, never before it: flipping first would light `Stop` on Codex nodes while the provider still throws `'Query aborted'` and loses new-thread ids.

## Files

| File | Change |
| --- | --- |
| `packages/providers/src/types.ts` | Export `STREAM_ABORT_TERMINAL_REASON = 'stream_aborted'` beside `MessageChunk`; widen the `interruptSignal` doc (`:601-609`) to cover `'stream-abort'` providers; update the `interrupt` axis comment (`:843-844`) — Codex now declares `'stream-abort'`; document on `terminalReason` (`result` chunk) that native providers forward the SDK value verbatim and stream-abort providers synthesize the constant. |
| `packages/providers/src/codex/capabilities.ts` | `interrupt: 'stream-abort'` with a one-line comment: abort the per-attempt `runStreamed` signal, continue on `resumeThread`. |
| `packages/providers/src/codex/provider.ts` | `streamCodexEvents` gains a trailing `interruptSignal?: AbortSignal` parameter and an interrupt-precedence rule at its **terminal** branches only; `sendQuery` attaches/removes an interrupt listener beside `onCallerAbort`, checks a spent interrupt signal before starting an attempt, makes the retry backoff sleep interrupt-aware, and short-circuits the outer catch before `classifyAndEnrichCodexError`. |
| `packages/providers/src/codex/provider.test.ts` | Update the runtime capability snapshot `'returns limited capability set for Codex provider'` (`:83-107`, a `.toEqual()` that pins `interrupt: false` — caught only by running the file, not by `tsc`); new `describe('CodexProvider turn interrupt (#184)')` — tests listed below, written first. |
| `packages/providers/src/codex/interrupt-resume-spike.ts` | Diagnostic real-SDK script (not exported, not CI), mirroring `claude/interrupt-resume-spike.ts`. |
| `packages/providers/package.json` | `"spike:interrupt:codex": "bun src/codex/interrupt-resume-spike.ts"`. |
| `reports/codex-interrupt-resume-spike.md` | Sanitized evidence, same layout as `reports/claude-interrupt-resume-spike.md`. Repo-root `reports/` is the deliberate choice — it follows the shipped Claude precedent even though the session rule prefers `plans/`/`docs/`; do not relocate during cook. |
| `packages/server/src/index.ts:205-217` (`handleUnhandledRejection`) | **Conditional.** Only if the spike observes an unhandled rejection from the kill: add the observed message class to the absorb allowlist with a comment naming the spike report. Today the allowlist absorbs only `'operation aborted'` and exits the process on anything else. |
| Other capability fixtures (`packages/providers/src/registry.test.ts`, `observability.test.ts`) | Only if they assert the Codex `interrupt` value at runtime; grep `interrupt:` in each before assuming `tsc` will report them. |

## Real-SDK gate (run before writing the seam)

`cd packages/providers && bun run spike:interrupt:codex` in a disposable temp git repository with an operator-provided Codex credential (env or `CODEX_HOME`), using the resolved Codex binary the provider would use. The script talks to the SDK directly (`new Codex(...)`, `startThread`, `resumeThread`, `runStreamed(prompt, { signal })`), not through `CodexProvider`, so it pins SDK behaviour rather than our seam.

Steps and evidence to record (all sanitized — no prompt text, nonce values, credentials, env values, cwd paths, or model content; the nonce is compared in memory and only booleans are written):

0. **Probes installed first.** `process.on('unhandledRejection')` and `process.on('uncaughtException')` counters; a child-process snapshot helper that lists descendants of the spike's own pid via `ps -o pid,ppid,command` filtered to `codex` (never printing the command line — record counts only).
1. **Turn 1 — new thread, interrupted mid-tool.** Prompt asks for a long shell command (e.g. a multi-second `sleep`) and to remember a random nonce. Record `msFromRunStreamedToThreadStarted`, `threadStartedBeforeFirstItem: boolean`, and `threadIdPropertyBeforeStarted` (the typeof/nullness of `thread.id` read immediately after `startThread()` — the provider seeds `resolvedThreadId` from it, so pin whether it is `null`, `undefined`, or already a string). On the first `item.started` of type `command_execution`, snapshot descendant processes, then call `controller.abort()`. Record the **terminal shape**: whether `runStreamed()` itself rejected; whether the events iterator (a) threw — record `error.name` and a redacted message class only (`AbortError` / `exited with code` / `killed` / other), (b) closed cleanly with no terminal event, or (c) emitted `item.completed` / `turn.failed` / `turn.completed` after the abort (list event types in order — an `item.completed` arriving after abort is the buffered-completion case the seam must keep yielding); `msFromAbortToIteratorSettled`; `survivingDescendantProcesses` re-snapshotted 1000 ms after settlement (orphaned shell/grandchildren of the killed `codex exec`).
2. **Turn 1b — abort before `thread.started`.** On a second fresh thread, call `controller.abort()` immediately after `runStreamed()` resolves (before any event). Record the same terminal-shape fields and whether any thread id was ever observable. This pins the pre-`thread.started` window the executor fails fast on.
3. **Unhandled-rejection settle.** After each abort wait a 1000 ms window; record `unhandledRejections`, `uncaughtExceptions` and the redacted `name` of each. This measures the #1735 hazard (`provider.ts:1189-1195`) for a mid-stream abort; node Cancel already aborts the same per-attempt controller mid-stream in production today, so a non-zero count here is a pre-existing bug surfaced, but it still blocks this story until the allowlist mitigation above is in place.
4. **Turn 2 — `resumeThread(threadId)`, interrupted again.** Prompt asks the model to echo the nonce and then run another long command; abort on the first `command_execution` `item.started`. Record `noThreadStartedOnResume: boolean` (the SDK emits `thread.started` only for new threads — `provider.ts:490-491`), `threadIdConsistent`, `nonceEchoedBeforeAbort: boolean`, and the same terminal-shape fields as turn 1.
5. **Turn 3 — resume and complete.** Same thread id, a short prompt that echoes the nonce, allowed to run to `turn.completed`. Record `turnCompleted: true`, `nonceEchoed: boolean`, `threadIdConsistent`, and that `usage` was present on `turn.completed`.
6. **Repeat turns 4–5 (interrupt + resume-and-complete) three times in total** on the same thread and record `resumeAfterKillSuccesses: n/3`. Two samples cannot distinguish a reliable resume from an intermittent one; three consecutive passes is the minimum for the "no new fail-loud path" decision in `plan.md`, and the residual risk is recorded in the report.
7. Output one JSON evidence document on stdout with `protocol: 'interrupt-turn-resume' | 'blocked'`, `sdkPin` (read from the installed package's `package.json` version), `failureCategory: null | 'timeout' | 'auth' | 'resume_failed' | 'iterator_hung' | 'unhandled_rejection' | 'context_lost' | 'orphaned_processes' | 'other'`, and non-zero exit when blocked. Every SDK call runs under `runWithExperimentTimeout` (reuse from `claude/askhuman-resume-spike.ts`) so a hung iterator is a recorded `iterator_hung`, not a hung script.

Gate outcomes:

- **Proceed** when: the iterator settles (throw or close) within the timeout after abort in every interrupted turn; zero unhandled rejections / uncaught exceptions (or the allowlist mitigation is added with the observed class); zero surviving descendant processes 1000 ms after settlement; `thread.started` precedes the first item on a new thread; every resume-after-kill repetition echoes the nonce and completes on the same thread id (`3/3`).
- **Block** when: any resume after a mid-tool kill fails or loses context, the iterator hangs after abort, descendants of the killed subprocess survive, or an unhandled rejection surfaces with no attributable message class to absorb. Record the evidence in the report and stop — do **not** substitute node Cancel, a "soft" stop that waits for the tool to finish, or a fresh-thread continuation under issue #184. Escalate: the only alternative transport is the app-server protocol, which is a separate story.

The spike is diagnostic, not CI. Unit tests below mock the SDK with the **observed** shapes plus the unobserved-but-possible ones, so the seam is robust to a shape change on an SDK bump.

## Implementation contract

### Provider-side interrupt precedence (terminal branches only)

Inside `streamCodexEvents(events, hasOutputFormat, threadId, abortSignal, surfaceMcpClientErrors, requestedModel, interruptSignal?)`:

- Define ONE module-level helper `abortMarkedResult(sessionId: string | undefined): MessageChunk` used by both the generator (with `resolvedThreadId`) and `sendQuery` (with `knownThreadId()`) — two definitions of the same shape is drift bait — returning `{ type: 'result', sessionId, terminalReason: STREAM_ABORT_TERMINAL_REASON, stopReason: 'aborted' }` — no `isError`, no `errorSubtype`, no `tokens` (none exist for a killed turn). The executor's marker check (`dag-executor.ts:2683-2696`) needs only `terminalReason`. `withResumedOutcome` (`provider.ts:1094-1106`, `shared/resumed.ts`) stamps `resumed` onto every `result` chunk in transit, including this one — tests must assert with `toMatchObject`, not an exact `toEqual`.
- **The between-events interrupt check is deliberately NOT a short-circuit.** Keep the existing top-of-loop `if (abortSignal?.aborted) throw new Error('Query aborted')` (node Cancel, `provider.ts:509-511`) exactly as is. Do not add an `interruptSignal` check there: after the kill the SDK may still deliver buffered `item.completed` events for a command that finished a moment before the signal landed, and those must still be yielded as normal `tool_result` chunks so the executor does not mislabel finished work as `⚠ interrupted`. The kill ends the iterator on its own (spike-verified); the interrupt therefore takes effect only at the terminal branches below.
- Precedence at every **terminal** branch: **node Cancel first, then operator interrupt, then the branch's normal behaviour.**
  - Pre-loop check (`provider.ts:496-499`): `if (abortSignal?.aborted) throw 'Query aborted'; if (interruptSignal?.aborted) { yield abortMarkedResult(); return; }`.
  - Wrap the `for await` in `try/catch`: on a thrown iterator error, rethrow `'Query aborted'` when `abortSignal` is aborted; yield the abort-marked result and `return` when `interruptSignal` is aborted; otherwise rethrow unchanged.
  - `turn.failed` (`:585-596`) and the post-loop clean close (`:851-860`): when `interruptSignal?.aborted && !abortSignal?.aborted`, yield the abort-marked result instead of `codex_turn_failed` / `codex_stream_incomplete`.
  - `turn.completed` (`:833-838`) is **not** overridden — a natural end that raced Stop keeps its normal result (executor case 1).
  - `runStreamed()`'s **own** rejection (it runs outside the generator, `provider.ts:1093`) is covered by the `sendQuery` outer-catch guard below — the fifth terminal site.
- The generator must never synthesize a `tool_result` for the cut-off tool; the executor's `settleRunningToolsOutcome(..., 'interrupted')` owns that row (`dag-executor.ts:2697-2710`, `:3110-3121`).
- A pure operator interrupt therefore **never** produces a `'Query aborted'` throw; that string remains the node-Cancel contract only. The executor's case-3 tolerance for it is defensive, not a Codex contract.

### `sendQuery` lifetime rules

- Keep the existing `if (requestOptions?.abortSignal?.aborted) throw 'Query aborted'` checks first (`:996`, `:1049`, `:1162`). Immediately after each, add `if (requestOptions?.interruptSignal?.aborted) { yield abortMarked(knownThreadId()); return; }` so a spent interrupt signal never starts or restarts a subprocess. **Deliberate divergence from Claude:** `claude/provider.ts:1728-1731` throws `'Query interrupted'` here; Codex yields a marker result instead so the one interrupt shape consumers see is always a `result` chunk carrying whatever thread id is known.
- `knownThreadId()` is `thread?.id ?? resumeSessionId ?? undefined` (optional chain — at the `:996` site `thread` does not exist yet) with `null` normalized to `undefined` (the SDK types `thread.id` as nullable before `thread.started`; the provider already seeds `resolvedThreadId` from it at `:1097`). On a fresh thread interrupted before `thread.started` this is `undefined`, which the executor turns into its explicit "returned no session id to resume" failure — the accepted behaviour. The spike's `threadIdPropertyBeforeStarted` field confirms it is never a placeholder string.
- Per attempt (`:1058-1069`): add `const onInterrupt = (): void => attemptController.abort();` registered on `requestOptions.interruptSignal` with `{ once: true }`; remove it in the same `finally` as `onCallerAbort` (`:1186-1188`). Both signals abort the same per-attempt controller; only what the generator yields afterwards differs.
- Pass `requestOptions?.interruptSignal` as the new last argument of `streamCodexEvents` (`:1095-1102`).
- Outer catch (`:1160-1185`): after the existing `abortSignal` rethrow, add the interrupt guard **before** `classifyAndEnrichCodexError` — `if (requestOptions?.interruptSignal?.aborted) { yield abortMarked(knownThreadId()); return; }`. This is the line that prevents `'killed'`/`'signal'` matching `SUBPROCESS_CRASH_PATTERNS` (`:313`) from scheduling a cold `startThread` retry (`:1073-1075`, `:1176-1183`). Log `codex.turn_interrupted` at info with `{ attempt, hasThreadId }` only — never the prompt or the thread id.
- **Interrupt-aware backoff.** Replace the bare `await new Promise(resolve => setTimeout(resolve, delayMs))` (`:1180`) with a delay that also resolves when `interruptSignal` or `abortSignal` aborts (clear the timer in both cases). An operator Stop landing during a genuine rate-limit/crash backoff must surface the marker immediately at the next top-of-loop check, not after up to `RETRY_BASE_DELAY_MS · 2^attempt` ms (`:302-303`).
- The skill-catalog compatibility fallback (`:1109-1158`) needs no change: once any event was emitted it rethrows to the outer catch, which now handles the interrupt case.
- Do not call `attemptController.abort()` from `finally` (the #1735 note stays true); the interrupt listener is removed there, and the registry already clears the controller at `endTurnStream` so a late interrupt cannot re-fire.

### Capability

`CODEX_CAPABILITIES.interrupt = 'stream-abort'`. This is the **only** gate: the executor computes `providerInterruptible` from the real registry's `getProviderCapabilities(provider).interrupt !== false` (`dag-executor.ts:3196`, `:5964`; `registry.ts:84`), which `dag-executor.test.ts` never mocks. The server and web react to the resulting registry flag and need no edits (verified in `plan.md` §Scope).

## Tests first (write red, then implement)

All in `packages/providers/src/codex/provider.test.ts`, using the existing mocked SDK (`mockRunStreamed`, `mockStartThread`, `mockResumeThread`). Use `retryBaseDelayMs: 0` everywhere except test 12. Assert result chunks with `toMatchObject` (the `resumed` stamp is always present). Each test name below is the `it(...)` title.

| # | Test | Asserts |
| --- | --- | --- |
| 1 | `declares stream-abort interrupt capability` | `CODEX_CAPABILITIES.interrupt === 'stream-abort'`; the `:83-107` snapshot updated to match. |
| 2 | `interrupt after thread.started yields an abort-marked result with the new thread id` | Events: `thread.started{thread_id:'t-new'}` → `item.started(command_execution)` → abort `interruptSignal` → mocked iterator throws `AbortError`. Yielded chunks end with `{type:'result', sessionId:'t-new', terminalReason:'stream_aborted'}`; no throw; no `tool_result` chunk; `mockRunStreamed` called once. |
| 3 | `buffered item.completed after the interrupt is still yielded as a normal tool_result` | Abort, then the mocked iterator delivers `item.completed` for the open command (exit 0) before throwing → a `tool_result` with `toolOutcome:'success'` precedes the marker result. |
| 4 | `interrupt on a clean iterator close yields the marker, not codex_stream_incomplete` | Iterator ends without a terminal after abort → marker result; `errorSubtype` undefined. |
| 5 | `interrupt on a turn.failed after abort yields the marker, not codex_turn_failed` | `turn.failed` after abort → marker result. |
| 6 | `natural turn.completed racing an interrupt keeps the natural result` | `turn.completed` arrives after abort → normal result with `tokens`, no `terminalReason`. |
| 7 | `interrupt never schedules a cold retry when the kill surfaces as a crash-shaped error` | Iterator throws `Error('Codex Exec exited with code 137 (killed by signal)')` after abort → marker result; `mockStartThread` called once total; `mockRunStreamed` called once. |
| 8 | `interrupt while runStreamed itself rejects yields the marker with the known thread id` | `mockRunStreamed` rejects after the interrupt fires; on a resumed thread the marker carries `'t-old'`; on a fresh thread (`thread.id` null) it carries `sessionId: undefined`. |
| 9 | `interrupt on a resumed thread carries the resumed id` | `resumeSessionId:'t-old'`, no `thread.started`, abort → marker with `sessionId:'t-old'`; `mockResumeThread` called with `'t-old'`. |
| 10 | `spent interrupt signal before the attempt never spawns and reports the resume id` | Pre-aborted `interruptSignal` + `resumeSessionId:'t-old'` → marker `{sessionId:'t-old'}`; `mockRunStreamed` not called. |
| 11 | `node cancel still throws Query aborted and wins over a co-fired interrupt` | Abort both signals (cancel first) → rejects `'Query aborted'`; no marker chunk yielded. |
| 12 | `interrupt during retry backoff surfaces without waiting out the delay` | `retryBaseDelayMs: 5000`; attempt 0 fails with a retryable crash unrelated to the operator; fire the interrupt 10 ms into the sleep → the generator finishes with the marker well under 1000 ms (assert elapsed), `mockRunStreamed` called once. |
| 13 | `interrupt signal is detached after the stream completes` | Complete a turn normally, then abort the interrupt controller: the captured per-attempt signal is **not** aborted and nothing throws. |
| 14 | `without an interrupt signal the per-attempt wiring is unchanged` | Existing tests at `:2446`, `:2537`, `:2583` still pass unmodified; assert `runStreamed` receives a per-attempt `AbortSignal` distinct from the caller's. |

Run: `cd packages/providers && bun test src/codex/provider.test.ts`. Then `bun test src/registry.test.ts && bun test src/observability.test.ts`, and `bun run type-check` at the root.

## Steps

1. Write and run the spike; commit the script, the `package.json` script, and the sanitized report. Stop here if the gate blocks. If the gate passed only with an observed unhandled-rejection class, add the `handleUnhandledRejection` allowlist entry in the same commit.
2. Add the failing tests 1–14 (update the `:83-107` snapshot as part of test 1).
3. Add `STREAM_ABORT_TERMINAL_REASON` and the doc updates in `types.ts`.
4. Implement the generator terminal-branch rule, the `sendQuery` lifetime rules and the interrupt-aware backoff; flip the capability in the same commit.
5. Green the tests; run `bun run type-check` and `bun run lint`.
6. Regenerate the capability matrix now so `check:capability-matrix` is green before Phase 2 (`bun run generate:capability-matrix`).

## Verification

```bash
cd packages/providers && bun run spike:interrupt:codex      # gate; evidence → reports/codex-interrupt-resume-spike.md
cd packages/providers && bun test src/codex/provider.test.ts
cd packages/providers && bun test src/registry.test.ts && bun test src/observability.test.ts
bun run type-check && bun run lint
bun run generate:capability-matrix && bun run check:capability-matrix
```

## Risks and rollback

- **Iterator does not settle after kill** (spike `iterator_hung`) — blocks the story. This dependency is not new: today's node-Cancel path already waits for the SDK iterator to throw or close after `attemptController.abort()`, because the between-events check at `provider.ts:509` only runs when a next event arrives. No bounded "drain race" is added speculatively; revisit only with evidence.
- **Resume after kill loses the partial turn** — the model would not see what it did before Stop; acceptable only if the nonce still echoes (context retained) in all three repetitions. Block if any fails.
- **Orphaned subprocess descendants** — a surviving shell would keep writing after the dock says the turn stopped; spike-gated, block if any survive.
- Rollback: revert the capability value and the provider seam; the constant and docs are harmless without a declaring provider.
