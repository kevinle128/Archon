---
phase: 2
title: 'Grok provider stream-abort seam'
status: pending
priority: P1
effort: '1d'
dependencies: [1]
---

# Phase 2: Grok provider stream-abort seam

> Spike outcome (fill from Phase 1 before starting): **A / B / C-partial** — `reports/grok-interrupt-resume-spike.md`.

## Goal

Make the Grok provider end only its current turn when the executor's per-turn `interruptSignal` fires: terminate the subprocess, settle open tools as `interrupted`, and yield one abort-marked terminal `result` that carries a resumable session id — while calls without `interruptSignal` and the node-level Cancel path stay byte-identical.

## Context links

- Decisions D1-D3, D6 in [plan.md](./plan.md); Phase 1 report.
- `packages/providers/src/grok/provider.ts` — `buildGrokArgs` (line 110), `sendQuery` (line 264), `terminate`/`scheduleKill`, post-stream branch order (lines 352-403).
- `packages/providers/src/grok/event-parser.ts` — `closeOutstandingTools` (line 97), `buildResult` (line 113), `observedResult`.
- Reference implementations: `packages/providers/src/e2e-fake/provider.ts:405-535` (`waitForBoundary`, `interruptedResult`), `packages/providers/src/claude/provider.ts:1681-1731,1961` (listener lifecycle, spent-signal preflight).
- Contract: `packages/providers/src/types.ts:602-609,839-847`.

## Key insights

- The executor already passes a fresh `interruptSignal` per pass to any provider whose `interrupt !== false` (`dag-executor.ts:2428-2435`, `:6319-6325`); declaring `'stream-abort'` is what switches Grok on.
- Branch order after the stream closes matters: Cancel throw → interrupt result → late I/O → protocol error → non-zero exit. Exit 143 must never reach `exitError()` on an interrupted turn.
- A tool result emitted by the provider with `toolOutcome: 'interrupted'` removes the tool from the executor's running map and persists `tool_outcome: 'interrupted'` (`dag-executor.ts:2639-2664`); the executor's own `settleRunningToolsOutcome` then finds nothing to double-write.

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/providers/src/grok/capabilities.ts` | modify | 1 line: `interrupt: 'stream-abort'` | `registry.test.ts` total-axis test keeps passing; "only Claude native" keeps passing |
| `packages/providers/src/grok/provider.ts` | modify | ~60 lines | new interrupt tests; existing tests unchanged |
| `packages/providers/src/grok/event-parser.ts` | modify | ~25 lines | new parser tests |
| `packages/providers/src/grok/provider.test.ts` | modify | ~200 lines | new describe block + controllable fake process |
| `packages/providers/src/grok/event-parser.test.ts` | modify | ~40 lines | `closeOutstandingTools(outcome)`, `buildInterruptedResult` |
| `packages/providers/src/types.ts` | modify | docstring only | none |

## Tests before (TDD)

Write these first; they must fail before the implementation and pass after.

### `event-parser.test.ts`

| # | Scenario | Assertion |
| --- | --- | --- |
| P1 | `closeOutstandingTools('interrupted')` with one open tool | one `tool_result` with `toolOutcome: 'interrupted'`, `outputState: 'unknown'`, map cleared |
| P2 | `closeOutstandingTools()` default | unchanged: `toolOutcome: 'unknown'` (regression pin) |
| P3 | `buildInterruptedResult('sid', 'aborted_streaming', undefined)` without `end` | `{type:'result', sessionId:'sid', terminalReason:'aborted_streaming'}`, no `isError`, no `errorSubtype` |
| P4 | same after an `end` with usage and `stopReason: 'cancelled'` | spend fields present, `stopReason: 'cancelled'`, `sessionId` from `end` |
| P5 | `buildResult` after no `end` (regression) | still `grok_incomplete_output` |

### `provider.test.ts` (fake spawner)

Add a `controllableProcess()` helper: stdout is a `ReadableStream` fed by a test-held controller; `kill(signal)` records the signal and, on the first `SIGTERM`, optionally flushes an `end` line (outcome A shape) then closes stdout and resolves `exited` (default 143). Pin the argv/session assertions with `buildGrokArgs` directly where possible.

| # | Scenario | Assertion |
| --- | --- | --- |
| T1 | `buildGrokArgs` with `interruptSignal`, no resume | argv contains `--session-id <uuid v4>`; the returned `sessionId` equals it |
| T2 | `buildGrokArgs` without `interruptSignal` | argv byte-identical to today (no `--session-id`); regression pin for direct chat |
| T3 | `buildGrokArgs` with `interruptSignal` + resume + `forkSession: true` | `--resume X --fork-session --session-id <uuid>` |
| T4 | `buildGrokArgs` with `interruptSignal` + resume, no fork | no `--session-id` (Grok rejects it) |
| T5 | interrupt mid-tool (outcome B shape: no `end`) | chunks: `tool` → `tool_result{toolOutcome:'interrupted'}` → `result{terminalReason:'aborted_tools', sessionId: pre-assigned}`; `kill` called with `SIGTERM` once; no throw; no `system` error chunk |
| T6 | interrupt mid-text, no open tool | `result{terminalReason:'aborted_streaming'}`, no `tool_result` |
| T7 | interrupt mid-tool, Grok flushes `end{stopReason:'cancelled', sessionId: same uuid, usage}` (outcome A) | `result` carries `terminalReason:'aborted_tools'`, spend, `sessionId === pre-assigned` |
| T8 | interrupt on a resumed turn (`resumeSessionId: 'sess-1'`) with no `end` | `result.sessionId === 'sess-1'`, `resumed: true` |
| T9 | Cancel and interrupt abort in the same tick | throws `'Query aborted'`; no abort-marked result yielded (Cancel dominates) |
| T10 | interrupt fires after `exited` resolved 0 and `end` already parsed | plain natural result, **no** `terminalReason` (five-case rule case 1) |
| T10b | interrupt fires after `end` was parsed but before `exited` resolved | plain natural result, no `terminalReason` |
| T10c | interrupt-capable turn with `persistSession: false` (new session) then redirect | decide once and pin: the redirect turn must fail loudly at `buildGrokArgs` (`provider.ts:111-113` throws on resume + `persistSession: false`) with a message naming `persist_session`, never silently start a fresh session |
| T16 | (only if Phase 1 E7 found a surviving child) interrupt mid-tool | the fake spawner records a process-group signal (negative pid) before the pid signal |
| T17 | interrupt-path grace constant | `scheduleKill` on the interrupt path uses the named interrupt grace constant (value fixed from E6: at least 2× the slowest observed SIGTERM exit, minimum 5000 ms); Cancel keeps `TERMINATION_GRACE_MS` |
| T11 | spent `interruptSignal` at entry | throws `'Query interrupted'` before `spawn` is called |
| T12 | interrupt, then stdout errors after kill | still the abort-marked result — never `grok_transport_error` |
| T13 | interrupt, exit code 143 | never `grok_exit_nonzero`; result is abort-marked |
| T14 | listeners removed in `finally` for both signals; SIGKILL timer cleared when the process exits within grace | `removeEventListener` observed on both signals; no dangling timer (use fake timers or assert `kill` not called with `SIGKILL`) |
| T15 | `end.sessionId` differs from the pre-assigned id | provider yields a `system` chunk naming the mismatch and uses the `end` id (log + surface; do not silently prefer either) |

## Refactor (protected changes)

1. `capabilities.ts`: `interrupt: 'stream-abort'`.
2. `buildGrokArgs`: accept `interruptCapable: boolean` (derived from `requestOptions?.interruptSignal !== undefined`); when true and (`!resumeSessionId` or `forkSession === true`) push `--session-id <uuid>` and return `sessionId`. Import `randomUUID` from `node:crypto`.
3. `sendQuery`:
   - preflight: `if (requestOptions?.interruptSignal?.aborted) throw new Error('Query interrupted')` after the existing Cancel preflight;
   - `let interruptedInFlight = false; const onInterrupt = () => { if (!processExited && parser.getSessionId() === undefined) { interruptedInFlight = true; terminate(); } };` attached with `{ once: true }`;
   - after `Promise.all([exitOutcome, stderrOutcome])`: **replace** the existing unconditional `closeOutstandingTools()` call (`provider.ts:352-354`, which today runs before the Cancel check and would empty the tool map as `'unknown'` before the interrupt branch could settle it) with a single `parser.closeOutstandingTools(interruptedInFlight ? 'interrupted' : 'unknown')`, executed after computing `hadOpenTool` and before the Cancel throw; then keep the Cancel throw; then `if (interruptedInFlight) { yield parser.buildInterruptedResult(sessionId, hadOpenTool ? 'aborted_tools' : 'aborted_streaming', resumed); log 'grok.query_interrupted'; return; }`;
   - `interruptedInFlight` is set only when the signal fires while the process is alive **and** no `end` event has been consumed yet (`parser.getSessionId() === undefined` at fire time); otherwise the turn is treated as natural (case 1);
   - `finally`: remove the interrupt listener beside the abort listener.
3b. Session-id reconciliation (drives T15): `const endId = parser.getSessionId(); const sessionId = endId ?? preAssignedSessionId ?? resumeSessionId;` — when `endId !== undefined && preAssignedSessionId !== undefined && endId !== preAssignedSessionId`, yield `{ type: 'system', content: 'Grok reported session <endId> for a turn Archon started as <preAssignedSessionId>; resuming the reported id.' }` before the result and log `grok.session_id_mismatch` at warn. The reported id wins because it is what Grok persisted.
3c. SIGKILL attribution: when the grace timer escalates to SIGKILL on an interrupted turn, yield a `system` chunk stating that Grok did not exit within the grace window and the session may be truncated, and log `grok.query_interrupt_killed`. A later resume failure is then attributable to the termination race rather than an opaque CLI error.
3d. If Phase 1 E7 showed a surviving tool child, `terminate()` on the interrupt path must signal the process group (spawn with `detached`/own group, then `process.kill(-pid, signal)` — mirror `claude/container-spawn.ts:99-119`), with a test asserting the group signal; otherwise leave `terminate()` unchanged and cite E7 in the report.
4. Grace decision (mandatory, drives T17): introduce `INTERRUPT_TERMINATION_GRACE_MS`, set from E6 to at least twice the slowest observed SIGTERM→exit time and never below 5000 ms, used only by the interrupt-path `terminate()`; leave `TERMINATION_GRACE_MS` for Cancel unchanged. Record the E6 numbers in the constant's comment.
5. `event-parser.ts`: `closeOutstandingTools(outcome: 'unknown' | 'interrupted' = 'unknown')`; new `buildInterruptedResult(sessionId: string | undefined, terminalReason: 'aborted_streaming' | 'aborted_tools', resumed: boolean | undefined)` built on `observedResult` with `terminalReason` added and no error fields. Keep `getSessionId()`.
6. `types.ts`: update the `interrupt` docstring — `'stream-abort'` is declared by Grok (SIGTERM on the CLI subprocess, session resumed with `--resume`); update the `interruptSignal` docstring to say native **and** stream-abort providers honour it.

## Tests after

The T1-T17 and P1-P5 matrix above is the "after" set; additionally assert in T5 that `abortSignal` was never aborted by the provider (pass a spy `AbortController`).

## Verification

```bash
cd packages/providers && bun test src/grok/event-parser.test.ts && bun test src/grok/provider.test.ts && bun test src/registry.test.ts && bun test src/observability.test.ts
bun run type-check && bun run lint
```

## Todo

- [ ] P1-P5 and T1-T17 written and failing
- [ ] Capability, argv, listener, branch order, parser changes implemented; matrix green
- [ ] `INTERRUPT_TERMINATION_GRACE_MS` fixed from E6 and pinned by T17; E7 outcome applied (T16 or a cited no-op)
- [ ] Docstrings in `types.ts` updated
- [ ] Existing Grok/registry/observability tests unchanged and green

## Success criteria

- All scenarios in the two matrices pass; `bun test src/grok/provider.test.ts` runs without opening a real process.
- Argv for non-interrupt callers is byte-identical (T2).
- No `isError` result and no throw on an operator interrupt; Cancel still throws `'Query aborted'`.

## Risk assessment

- The 5 s grace was tuned by Cancel, not by session persistence; E6 samples a handful of short turns. Step 3c makes a truncated persist attributable; if E6 shows any exit above ~2.5 s, prefer a larger interrupt-path grace (documented constant) over trusting the margin.
- Flipping the capability makes the executor hand every Grok workflow pass an `interruptSignal` (`dag-executor.ts:2427-2435`, `:6319-6325`), so `--session-id` pre-assignment applies to **every new Grok workflow-node session**, not only interrupted ones; direct chat is unaffected. No code reads Grok-generated ids specially (grep `sessionId` consumers in `packages/core` and `packages/workflows` — ids are opaque strings), but T1/T2 pin the boundary.
- On Windows the `cmd.exe` wrapper (`buildSpawnCommand`) receives the SIGTERM, not the real `grok` child — inherited from the Cancel path, out of scope here; do not assume stream-abort fixes it.

- Grok may exit with a signal rather than 143 under SIGKILL; classification never reads the exit code on the interrupt path, so this is cosmetic but must be logged.
- A Stop during the pre-tool phase may leave an unresumable session (C-partial); the redirect turn then fails with Grok's verbatim resume error — documented, never masked.

## Security considerations

- The pre-assigned id is a random UUID, never derived from user input; it is passed as argv exactly like `--resume` today.

## Next steps

Phase 3 proves the executor contract with the exact chunk shapes T5-T8 produce.
