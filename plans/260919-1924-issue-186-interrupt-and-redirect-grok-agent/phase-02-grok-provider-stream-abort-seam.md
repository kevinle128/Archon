---
phase: 2
title: 'Grok provider stream-abort seam'
status: pending
priority: P1
effort: '1-1.5d'
dependencies: [1]
---

# Phase 2: Grok provider stream-abort seam

## Entry gate

Copy the Phase 1 report's exact CLI version, minimum-version decision, graceful-exit bound, process-group decision, and Windows result into this phase before editing production code. If any release gate is not `PASS`, stop.

## Goal

Make Grok end only its current CLI turn when `interruptSignal` fires, return a resumable provider-normalized interrupt result, and preserve open-tool outcome, Cancel semantics, natural completion, and genuine failure causality.

## Files

| File                                                 | Action                | Responsibility                                                                                 |
| ---------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/providers/src/grok/capabilities.ts`        | modify last           | Advertise `'stream-abort'` after implementation/tests and Phase 1 gates pass                   |
| `packages/providers/src/grok/provider.ts`            | modify                | Assigned IDs, interrupt listener, shutdown cause, graceful/forced termination, structured logs |
| `packages/providers/src/grok/event-parser.ts`        | modify                | End-state query, parameterized tool closure, interrupted result builder                        |
| `packages/providers/src/grok/provider.test.ts`       | modify                | Controllable-process and race tests                                                            |
| `packages/providers/src/grok/event-parser.test.ts`   | modify                | Parser/result tests                                                                            |
| `packages/providers/src/types.ts`                    | modify                | Provider-neutral interrupt/terminal-reason documentation                                       |
| `packages/providers/src/grok/usage-contract.test.ts` | modify only if needed | Pin that no-end interrupt does not fabricate aggregate spend                                   |

If Phase 1 proves group termination is required, the same provider/test files also extend `GrokProcess` with the minimum PID/group information and `GrokSpawnOptions` with explicit POSIX group ownership. Do not add those fields when the evidence says the child is already reaped.

## TDD matrix

### Parser tests

| ID  | Scenario                                                   | Required assertion                                                                          |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P1  | open tool then `closeOutstandingTools('interrupted')`      | one interrupted `tool_result`; second close is empty                                        |
| P2  | default `closeOutstandingTools()`                          | remains `unknown`                                                                           |
| P3  | any validly parsed `end`, including one with no session ID | `hasEnded()` is true; this is independent of `getSessionId()`                               |
| P4  | `buildInterruptedResult` with concrete ID and no `end`     | non-error result, correct terminal reason/session/resumed state, no incomplete-output error |
| P5  | interrupted result after an `end`                          | retains authoritative aggregate usage/cost and reported ID                                  |
| P6  | ordinary `buildResult` without `end`                       | remains `grok_incomplete_output`                                                            |

`buildInterruptedResult` accepts a required `string` session ID. Do not make it optional and defer a broken invariant to the executor.

### Provider tests

Extend the current fake spawner with a controllable process whose stdout can remain open, flush an optional `end`, resolve with a chosen exit code, and record SIGTERM/SIGKILL. Keep all tests offline.

| ID  | Scenario                                                         | Required assertion                                                                                          |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| T1  | new/forked interrupt-capable turns                               | new UUID passed through `--session-id`; resumed non-fork turn uses the old ID and adds no new flag          |
| T2  | no `interruptSignal`                                             | argv remains byte-for-byte compatible and has no assigned ID                                                |
| T3  | interrupt already spent initially or during binary resolution    | no query process spawned; `Query interrupted`                                                               |
| T4  | signal fires after spawn but before/while listener installation  | immediate post-registration recheck catches it exactly once                                                 |
| T5  | mid-tool, no `end`, graceful exit 143                            | tool → interrupted tool result → non-error `aborted_tools` result with assigned ID; one SIGTERM, no SIGKILL |
| T6  | mid-text, no open tool                                           | non-error `aborted_streaming`; no synthetic tool result                                                     |
| T7  | SIGTERM flushes matching `end`                                   | reported ID and aggregate usage/cost retained; still normalized as interrupted                              |
| T8  | interrupted resumed turn                                         | result carries the existing ID and `resumed: true`                                                          |
| T9  | `end` parsed before Stop                                         | natural unmarked result; no termination signal                                                              |
| T10 | Cancel alone or racing Stop                                      | existing `Query aborted` path wins; no interrupt result                                                     |
| T11 | Stop claimed first, then induced stdout/stderr error or exit 143 | remains interrupted, not a transport/non-zero-exit failure                                                  |
| T12 | protocol/transport failure recorded first, then Stop             | real failure retained; Stop cannot relabel it as interrupted                                                |
| T13 | graceful timer expires and SIGKILL is sent                       | distinct non-abort failure; no resumable result; structured escalation log                                  |
| T14 | `end.sessionId` differs from assigned ID                         | use reported ID, structured warning, no user-facing `system` chunk                                          |
| T15 | no assigned/resumed/reported ID at interrupt settlement          | fail fast; never emit an abort marker without a resumable ID                                                |
| T16 | normal/error/interrupted cleanup                                 | both listeners removed, timers cleared, process awaited once, no extra kill after exit                      |
| T17 | Phase 1 required group termination                               | own and signal the POSIX group; retain explicit Windows behaviour proved by S4                              |

Also retain every existing Grok provider, parser, and usage-contract test unchanged unless the asserted public contract intentionally changes above.

## Implementation design

### Assigned session identity

- Extend `buildGrokArgs` to return the optional assigned session ID as well as args/model/effort.
- Generate with `node:crypto.randomUUID()` only for interrupt-capable new or forked turns.
- Resolve effective ID as `parser.getSessionId() ?? assignedSessionId ?? resumeSessionId` after the process ends. A reported mismatch logs a warning and the reported ID wins because it names what Grok persisted.

### Race-free listener lifecycle

1. Check Cancel, then interrupt, before binary resolution.
2. Resolve configuration/binary; recheck both before spawning so a signal during setup does not launch a new process.
3. Spawn and create parser/state.
4. Install both listeners; immediately call the corresponding handler if a signal is already aborted.
5. Remove both listeners and clear the escalation timer in `finally`; await the process streams once.

Handlers are idempotent. They must not create multiple timers or send duplicate signals.

### Causal shutdown state

Use an explicit internal shutdown cause (for example `none | interrupt | fault`) plus the existing Cancel signal and a `forcedKill` flag. The first interrupt/fault claimant wins; Cancel remains a final dominant check. Parser failures and stream failures claim `fault` before terminating. Stop claims `interrupt` only while the process is alive, before `parser.hasEnded()`, and when no fault already owns shutdown.

This ordering yields:

1. Cancel check;
2. forced-kill failure;
3. graceful interrupt result;
4. late I/O / protocol / non-zero-exit handling;
5. normal result.

Do not use `getSessionId() === undefined` as “not ended,” and do not let a late Stop suppress an earlier failure.

### Tool and result settlement

- Change `closeOutstandingTools` to accept `'unknown' | 'interrupted'` with `'unknown'` default and return the emitted list; its length determines `aborted_tools` versus `aborted_streaming` without exposing parser internals.
- Add `buildInterruptedResult(sessionId: string, terminalReason, resumed)` using the parser's observed result fields but removing incomplete/error fields. Preserve aggregate usage only when `end` supplied it.
- Close tools once, after shutdown cause is known. Interrupted cause uses `interrupted`; all other paths use `unknown`.
- Do not emit a `system` warning for session reconciliation or escalation. A forced escalation is a failure; a mismatch is a structured log. This keeps direct and loop behaviour identical.

### Process termination

- Keep Cancel's current five-second behaviour unless Phase 1 independently disproves it.
- Use the Phase 1 grace for interrupt-driven SIGTERM. Name and comment the constant with its evidence report, but do not encode sample math such as “2× slowest” as runtime policy.
- Track whether the escalation callback fired. SIGKILL always changes an operator interrupt into a real provider failure because the session cannot be claimed durable.
- Add process-group mechanics only if S1 found a surviving child. On POSIX, use an owned group and signal the group without broad matching; on Windows use only the launch/termination path S4 proved.

### Capability and contract docs

- Change `GROK_CAPABILITIES.interrupt` from `false` to `'stream-abort'` only after all Phase 2 tests pass.
- Update `AgentRequestOptions.interruptSignal`, `ProviderCapabilities.interrupt`, and result `terminalReason` comments so they describe native and stream-abort providers rather than Claude alone.
- Do not change executor/registry behaviour or add a Grok-specific terminal reason.

## Verification

```bash
cd packages/providers
bun test src/grok/event-parser.test.ts
bun test src/grok/provider.test.ts
bun test src/grok/usage-contract.test.ts
bun test src/registry.test.ts
bun test src/observability.test.ts
cd ../..
bun run type-check
bun run lint --max-warnings 0
```

## Completion checklist

- [ ] Phase 1 gate values copied here and still valid for the binary under test
- [ ] P1-P6 and T1-T16 pass; T17 included when required by evidence
- [ ] Cancel/natural/fault/interrupt/forced-kill causality is explicit and tested
- [ ] No interrupted result can omit a concrete session ID
- [ ] Open tools close exactly once with the correct outcome
- [ ] No-end interruption fabricates neither aggregate tokens nor USD
- [ ] Capability flips only after tests and platform gate pass
- [ ] Focused provider/type/lint gates pass

## Rollback

Set the capability back to `false` first. The provider changes are then dormant because workflows stop receiving Grok `interruptSignal`; caller-assigned session IDs already persisted remain valid.
