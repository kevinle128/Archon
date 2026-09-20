---
phase: 2
title: "Grok provider stream-abort seam"
status: pending
priority: P1
effort: "1.5-2d"
dependencies: [1]
---

# Phase 2: Grok provider stream-abort seam

## Entry gate

Copy from `plan.md` → `## Validation Log` before editing production code: exact CLI build, `M` (materialization boundary), `INTERRUPT_ARM_TIMEOUT_MS`, interrupt grace, process-group decision, resumed-turn policy (S3b), Windows decision, version floor. If gate 2 is not PASS, or gate 5 is neither PASS nor a recorded decision, **stop**. Cook runs a scout pass on `provider.ts`, `event-parser.ts`, and their tests first — line numbers below are from 2026-09-20 and will drift.

## Goal

When `interruptSignal` fires, the Grok provider ends only the current CLI turn — at or after `M`, via a group SIGTERM — and yields the exact Grok abort triple with a resumable session id. Cancel, natural completion, and genuine failures keep their causality. `GROK_CAPABILITIES.interrupt` flips to `'stream-abort'` as the **last** step of this phase, only when every test below passes.

## Context links

- Provider: `packages/providers/src/grok/provider.ts` — `defaultSpawner` :58, `buildSpawnCommand` :83, `buildGrokArgs` :110, `scheduleKill` :201, `sendQuery` :264 (`abortSignal` listener :334, tool closure :353, result :403, `finally` :405).
- Parser: `packages/providers/src/grok/event-parser.ts` — `closeOutstandingTools` :97, `buildResult` :113 (`grok_incomplete_output` when `!sawEnd || !sessionId` :123), `consumeEnd` sets `sessionId` :292.
- Contract: `packages/providers/src/types.ts` — `interruptSignal` :602-609, `ProviderCapabilities.interrupt` :839-847, result chunk :333-366, `toolOutcome` :395.
- Precedents: DeepSeek abort triple `packages/providers/src/community/deepseek/acp-client.ts:112-119`, cause-aware cancel :361-422; Claude interrupt lifecycle `packages/providers/src/claude/provider.ts` (search `interruptSignal`).
- Existing tests: `packages/providers/src/grok/provider.test.ts` (`processFor` :14, controllable process with `kill` recorder :350-381), `event-parser.test.ts`, `usage-contract.test.ts`.

## Files to create / modify

| File | Action | Size | Test impact |
|------|--------|------|-------------|
| `packages/providers/src/grok/provider.ts` | modify | +180–250 | T1–T24 |
| `packages/providers/src/grok/event-parser.ts` | modify | +40–60 | P1–P6 |
| `packages/providers/src/grok/capabilities.ts` | modify **last** | 1 line | `registry.test.ts`, capability matrix |
| `packages/providers/src/grok/config.ts` | modify | +5 | exports `GROK_MIN_INTERRUPT_CLI_VERSION` (consumed in Phase 4) |
| `packages/providers/src/grok/provider.test.ts` | modify | +400–500 | new controllable-process helper + T-matrix |
| `packages/providers/src/grok/event-parser.test.ts` | modify | +80 | P-matrix |
| `packages/providers/src/grok/usage-contract.test.ts` | modify if needed | +20 | pin no fabricated spend on no-`end` interrupt |
| `packages/providers/src/types.ts` | modify (comments only) | ~10 | none |

No executor, registry, route, or UI file is touched in this phase.

## Architecture

### Interrupt state machine (per `sendQuery` call)

```
                 interruptSignal.abort
   ┌──────────┐  before M           ┌──────────────┐  M observed   ┌────────────┐
   │ running  │────────────────────▶│ stop-pending │──────────────▶│ stopping   │
   │ (pre-M)  │                     │ (arm timer)  │               │ SIGTERM grp│
   └────┬─────┘                     └──────┬───────┘               └─────┬──────┘
        │ M observed                       │ arm timeout                 │ exit ≤ grace
        ▼                                  ▼                             ▼
   ┌──────────┐ interruptSignal.abort ┌──────────────┐          ┌──────────────────┐
   │ running  │──────────────────────▶│ FAIL:        │          │ abort triple +   │
   │ (post-M) │  → stopping directly  │ unpersisted  │          │ resumable id     │
   └──────────┘                       └──────────────┘          └──────────────────┘
                                                            grace expires → SIGKILL grp
                                                            → FAIL: grok_interrupt_forced_kill
```

- Entering `stop-pending` emits `getLog().info({ assignedSessionId }, 'grok.interrupt_pending')`; leaving it emits `grok.interrupt_armed`. While pending nothing is signalled and the dock shows the generic `Stopping…`; node Cancel remains immediate throughout (red-team #9, accepted UX gap — no UI work in this story).
- The state machine above applies to fresh and forked turns. **Resumed turns** (`resumeSessionId` set, no fork) skip `stop-pending` and signal immediately when Phase 1 S3b passed — the session already exists on disk and `resumeSessionId` is the resumable id; if S3b failed they follow the same `M`-armed path (red-team #16).
- `M` is detected in the stdout loop by the parser (`parser.hasMaterialized()` — true once the Phase 1 boundary event type has been consumed; implement as a parser method keyed on the event type Phase 1 recorded, not on line count).
- Shutdown cause is an explicit union `'none' | 'interrupt' | 'cancel' | 'fault'`; first claimant wins, except Cancel, which is re-checked last and dominates (`abortSignal.aborted` → throw `Query aborted`, unchanged from today).
- `fault` is claimed by parser protocol errors, stream/exit rejections, and by the arm-timeout and SIGKILL escalation paths. An interrupt can never relabel an earlier fault; a later fault (e.g. exit 143, broken pipe after SIGTERM) never relabels an earlier interrupt.

### Process group and termination

- `defaultSpawner`: `Bun.spawn({ …, detached: process.platform !== 'win32' })`; `GrokProcess` gains `pid: number`; `kill(signal)` first signals the leader through Bun's own handle (`proc.kill(signal)`, immune to PID reuse), then sends `process.kill(-pid, signal)` to the group **only while `proc.exited` is still unresolved** (tracked by `processExited`, re-checked synchronously immediately before the syscall), swallowing `ESRCH`. The residual window between the check and the syscall is documented in a comment as a known limitation (red-team #3). On win32 the termination path is exactly what Phase 1 S4 recorded when the decision is (a) proven; for decisions (b) POSIX-only or (c) scope-out, the win32 branch fails the turn with `grok_interrupt_unsupported_platform` **when the interrupt fires** — never a silent no-op, and never at spawn, so ordinary Windows Grok turns keep working (red-team #12). Do not leave `proc.kill('SIGTERM')` as an unexamined default.
- `scheduleKill` is reused for both Cancel and Stop. Cause attribution is tracked in `causesPendingKill: Set<'interrupt' | 'cancel'>` **independently of whether a new timer was scheduled**, so a Stop-then-Cancel race records both; the SIGKILL callback sets `forcedKill = true`, and at settlement Cancel dominates (`Query aborted`) while an interrupt-only forced kill is `grok_interrupt_forced_kill` (red-team #13).
- Constants (named, commented with the Phase 1 report path): `INTERRUPT_GRACE_MS`, `INTERRUPT_ARM_TIMEOUT_MS`, existing `TERMINATION_GRACE_MS`.

### Assigned session identity (D5)

- `buildGrokArgs` returns `{ args, model, effort, assignedSessionId? }`. Generate `randomUUID()` and push `--session-id <uuid>` **only** when `requestOptions.interruptSignal !== undefined` and the turn is new (`resumeSessionId === undefined`) or forked (`forkSession === true`). A resumed non-fork turn keeps the old id and adds no flag. Calls without `interruptSignal` keep byte-identical argv (T2).
- Effective id at settlement: `parser.getSessionId() ?? assignedSessionId ?? resumeSessionId`. If a reported id exists and differs from the assigned id (fresh/forked turn) or the resumed id (non-fork resume), the turn **fails closed**: `claimFault` with `grok_session_id_mismatch`, `getLog().error({ assigned, reported }, 'grok.session_id_mismatch')`, no abort marker, no `system` chunk. The CLI's echo of `--session-id` is a contract; a divergence means the persisted identity is unknown and must not be resumed (red-team #2).

### Tool and result settlement (D3, D4)

- `closeOutstandingTools(outcome: 'unknown' | 'interrupted' = 'unknown')` returns the emitted chunks; `toolOutput` reads `'Grok was interrupted before reporting a tool result.'` for the interrupted case.
- `buildInterruptedResult(sessionId: string, resumed: boolean | undefined): ResultChunk` — required string id; carries `stopReason: 'aborted'`, `isError: true`, `errorSubtype: 'grok_aborted'`, `sessionId`, `resumed`, plus aggregate `tokens`/`cost`/`usageBreakdown` **only** if an `end` was parsed before exit (T7). No `errors` array, no `grok_incomplete_output`.
- Settlement order in `sendQuery` after `Promise.all([exitOutcome, stderrOutcome])`: (0) **unconditionally** yield `closeOutstandingTools(cause === 'interrupt' ? 'interrupted' : 'unknown')` — this must stay ahead of the Cancel throw exactly as today (`provider.ts:352-354`), because the executor settles open tools only on a `result` chunk and never in its catch/cancel paths (red-team #7); (1) Cancel → throw `Query aborted`; (2) `forcedKill` or arm-timeout fault → failure per the existing late-I/O rule; (3) interrupt cause → `buildInterruptedResult`; (4) existing late-I/O / protocol / non-zero-exit handling; (5) normal `buildResult`.
- A protocol error raised by a **truncated trailing fragment after** the interrupt was claimed (SIGTERM racing Grok's last write) does not relabel the interrupt — the id is confirmed by Phase 1 resume evidence, not by an `end` event (round-1 S1/S3 resumed with no `end`). A protocol error claimed **before** the interrupt keeps failing (red-team #8, T13/T23).

## Tests before (regression coverage written first)

Add these before refactoring; they must pass on the current code and keep passing:

- `provider.test.ts`: "argv without interruptSignal is unchanged" — snapshot `buildGrokArgs` output for new, resumed, and forked turns (becomes T2).
- `provider.test.ts`: "Cancel sends SIGTERM and throws Query aborted" already exists (:350-381) — extend the fake `kill` recorder to also capture `pid`-targeting so the group-kill refactor is observable.
- `event-parser.test.ts`: "closeOutstandingTools default is unknown" (becomes P2) and "buildResult without end is grok_incomplete_output" (P6).
- `usage-contract.test.ts`: existing fixture stays untouched.

## Refactor

1. Extend `GrokProcess`/`defaultSpawner` with `pid` and group-aware `kill`; keep `GrokSpawner` signature so tests keep injecting fakes. Migrate the five existing fakes in `provider.test.ts` to supply `pid`: `processFor` (:15), `processWithStderrReject` (:39), `processWithExitReject` (:52), `processWithStdoutFailAfter` (:63), and the inline Cancel fake (:353) (red-team #10).
2. Thread `assignedSessionId` through `buildGrokArgs` → `sendQuery`.
3. Introduce the shutdown-cause union, `stopPending`, arm timer, `forcedKill` flag; convert `terminate()`/`onAbort()` to cause-aware handlers (`requestInterrupt()`, `requestCancel()`, `claimFault(err)`).
4. Parser: `hasMaterialized()`, `hasEnded()`, parameterized `closeOutstandingTools`, `buildInterruptedResult`.
5. Listener lifecycle: check **Cancel** before binary resolution and again before spawn (unchanged `Query aborted`); never short-circuit on `interruptSignal` pre-spawn — an already-aborted interrupt becomes `stop-pending` at spawn so a fresh turn still gets an assigned id (T3). Install both listeners after spawn and immediately re-check `.aborted` (T4); remove both and clear both timers in `finally`.
6. Comments in `types.ts`: `interruptSignal`, `ProviderCapabilities.interrupt`, `toolOutcome: 'interrupted'` describe native **and** stream-abort providers.
7. Last: `GROK_CAPABILITIES.interrupt = 'stream-abort'`; run `bun run generate:capability-matrix`.

## Tests after (new behaviour)

### Parser matrix (`event-parser.test.ts`)

| ID | Scenario | Assertion |
|----|----------|-----------|
| P1 | open tool, `closeOutstandingTools('interrupted')` | one `tool_result` with `toolOutcome: 'interrupted'`, `outputState: 'missing'`; second call returns `[]` |
| P2 | `closeOutstandingTools()` default | outcome stays `unknown` |
| P3 | `hasMaterialized()` | false before the Phase-1 boundary event type; true after it, regardless of `end` |
| P4 | `buildInterruptedResult('sess-1', undefined)` with no `end` | exact triple + `sessionId`, no `errors`, no `usageBreakdown`, `resumed` undefined |
| P5 | `buildInterruptedResult` after an `end` with usage | triple retained; `tokens`/`cost`/`usageBreakdown` equal `buildResult`'s |
| P6 | `buildResult` without `end` | still `grok_incomplete_output` |

### Provider matrix (`provider.test.ts`, offline, controllable fake process)

The helper exposes: `pushLine(json)`, `closeStdout()`, `resolveExit(code)`, `rejectExit(err)`, recorded `signals: Array<{signal, target: 'group' | 'pid'}>`, and a fake clock or short real timers for arm/grace.

| ID | Scenario | Assertion |
|----|----------|-----------|
| T1 | new / forked turn with `interruptSignal` | `--session-id <uuid>` present; resumed non-fork turn keeps `--resume <old>` and no `--session-id` |
| T2 | no `interruptSignal` | argv byte-identical to pre-change snapshot; no assigned id |
| T3 | `interruptSignal` already aborted before spawn | fresh/forked: still spawns with an assigned id, enters `stop-pending`, arms at `M` → triple. Resumed (S3b passed): spawns, signals immediately → triple with `resumeSessionId`, `resumed: true`. Only Cancel short-circuits pre-spawn |
| T3b | resumed turn, Stop pre-M, S3b policy | no `stop-pending`; one group SIGTERM at once; triple with `resumeSessionId`; the arm timer is never started |
| T4 | signal aborts between spawn and listener install | post-registration re-check fires the handler exactly once |
| T5 | Stop pre-M, then `M` line arrives | no SIGTERM before `M`; exactly one group SIGTERM after; exit 143 → triple with assigned id; no SIGKILL |
| T6 | fresh turn, Stop pre-M, no stdout until arm timeout | SIGTERM→(SIGKILL if needed) → **failure** `grok_interrupt_unpersisted`, never the triple; structured `grok.interrupt_unpersisted` log (resumed turns never reach this state when S3b passed) |
| T7 | Stop post-M mid-tool, process exits with **no** `end` (the observed round-1 S1 shape) | tool → interrupted `tool_result` → triple with the assigned id, `resumed` undefined, no `tokens`/`cost`/`usageBreakdown` |
| T7b | Stop post-M, an `end` (with usage and matching id) arrives after SIGTERM but before exit — race robustness, not the expected path | triple with the reported id and aggregate usage retained; still classified interrupted |
| T8 | Stop post-M mid-text, no open tool, no `end` | triple with assigned id; no synthetic `tool_result`; no usage fields |
| T9 | Stop on a resumed turn | triple carries the resumed id and `resumed: true` |
| T10 | `end` parsed before Stop | natural unmarked result; no signal sent |
| T11 | Cancel alone, or Cancel racing Stop | `Query aborted` thrown; no triple; one group SIGTERM |
| T12 | Stop claimed first, then broken-pipe / exit 143 / stderr noise | still the triple, not `grok_transport_error` / `grok_exit_nonzero` |
| T13 | protocol error (`consumeLine` throws) first, then Stop | `grok_protocol_error` retained; Stop cannot relabel it |
| T14 | grace expires → SIGKILL | failure `grok_interrupt_forced_kill`; no triple; escalation log |
| T15 | `end.sessionId` ≠ assigned (or ≠ resumed id on a non-fork resume) | failure `grok_session_id_mismatch`; no triple; error log; no `system` chunk |
| T16 | interrupt settles with no assigned/resumed/reported id (fresh turn, `interruptSignal` given, but assignment disabled by test seam) | throws — never a triple without an id |
| T17 | POSIX `defaultSpawner` shape | `detached: true`; `kill` signals the leader via the Bun handle then the group; no group signal after `processExited`; `ESRCH` swallowed |
| T18 | win32 branch | exactly the behaviour the Phase 1 Windows decision names (no inferred default) |
| T19 | cleanup on natural / error / interrupted / cancelled ends | both listeners removed, arm + grace timers cleared, no signal after exit |
| T20 | repeated Stop (second abort on the same signal or a second turn) | idempotent: one signal, one result |
| T21 | `closeOutstandingTools` runs once per turn | exactly one `tool_result` per open tool across interrupt + late-I/O paths |
| T22 | Cancel with an open tool (alone, or racing Stop) | the `unknown` (or `interrupted`) `tool_result` is still yielded **before** `Query aborted` is thrown — today's behaviour preserved |
| T23 | Stop claimed post-M, then the final stdout line is a truncated JSON fragment | still the triple with the assigned/resumed id; the trailing protocol error is logged, not surfaced as `grok_protocol_error` |
| T24 | win32 with decision (b)/(c): `interruptSignal` fires | failure `grok_interrupt_unsupported_platform` at fire time; a turn whose signal never fires completes normally |

`usage-contract.test.ts`: add one case pinning that a no-`end` interrupted result has **no** `usageBreakdown` (no fabricated spend).

## Implementation steps

1. Write "Tests before"; run the Grok suites — green.
2. Write P1–P6 (red), implement parser changes (green).
3. Write T1–T4, T10–T11, T17 (red), implement spawner/args/listener lifecycle (green).
4. Write T5–T9, T12–T16, T19–T21 (red), implement state machine + settlement (green).
5. Write T18 per the Windows decision (red → green).
6. `types.ts` comment pass; `registry.test.ts` still green.
7. Flip capability; regenerate matrix; run the regression gate.

## Todo

- [ ] Tests before green on unchanged code
- [ ] Parser P1–P6
- [ ] Spawner / args / listeners T1–T4, T10–T11, T17
- [ ] State machine + settlement T5–T9, T12–T16, T19–T23
- [ ] Windows branch T18/T24 per recorded decision
- [ ] Contract comments
- [ ] Capability flip + matrix regeneration

## Regression gate

```bash
cd packages/providers
bun test src/grok/event-parser.test.ts && bun test src/grok/provider.test.ts && bun test src/grok/usage-contract.test.ts && bun test src/registry.test.ts && bun test src/observability.test.ts
cd ../.. && bun run type-check && bun run lint --max-warnings 0 && bun run check:capability-matrix
```

## Success criteria

- Every row of P1–P6 and T1–T24 passes; all pre-existing Grok tests pass unchanged.
- No code path can yield the triple without a concrete session id.
- SIGKILL escalation and arm timeout are failures with distinct `errorSubtype`s and structured logs.
- Cancel still throws `Query aborted` and now signals the group.

## Risk assessment

- **Bun `detached` semantics** — puts Grok in its own session; if Grok's TTY/signal handling changes behaviour, Phase 1 S1g catches it before this phase. Keep the fallback to pid kill only for `ESRCH`.
- **Arm timeout too short** — a slow cold start would turn Stop into a failure. Mitigation: derived from Phase 1 samples with 3× margin, minimum 30 s.
- **Orphan on Archon crash (pre-existing)** — a child of a crashed server survives with or without `detached`; D2 does not widen this class. Noted for operations; not addressed in this story (red-team #11).
- **Stop appears inert while `stop-pending`** — only when Grok has emitted nothing; bounded by `INTERRUPT_ARM_TIMEOUT_MS`; Cancel stays immediate (red-team #9).
- **Prompt loss before `M`** — if `M` precedes prompt persistence, the redirect turn carries only the operator's guidance. Phase 1 records this; Phase 4 documents it.

## Security considerations

Session ids are opaque UUIDs. Logs carry ids and cause names, never prompt or output text. Group kill targets only the process group the provider created.

## Rollback

Revert the capability constant first (dormant seam), then the provider files if needed.

## Next steps

Phase 3 consumes the exact chunk sequence: `[tool]* → tool_result(interrupted)* → result(triple, sessionId, resumed?)`.
