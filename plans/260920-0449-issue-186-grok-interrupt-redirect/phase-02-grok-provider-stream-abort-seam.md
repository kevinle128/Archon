---
phase: 2
title: 'Grok provider stream-abort seam'
status: pending
priority: P1
effort: '1.5-2d'
dependencies: [1]
---

# Phase 2: Grok provider stream-abort seam

## Entry gate

Do not edit production code until every field in `plan.md`'s validation log is filled from a PASS round-two report. Copy the report's exact `M`, resumed-turn policy, platform tree primitives, measured graceful-exit bound, and validated build into the implementation PR description.

If any host, prompt-retention, fork, descendant, or sub-second gate is missing or failed, stop. There is no platform exception or 30-second pending fallback in this plan.

## Goal

Teach `GrokProvider` to react to the optional turn-scoped `interruptSignal` while preserving the existing node-Cancel, natural completion, error, argv, and accounting contracts. A graceful Stop after the proven safe boundary yields the exact Grok abort result and a resumable id. All other shutdown causes remain honest failures or the existing Cancel throw. Keep the capability false throughout this phase.

## Files

| File                                                 | Change                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/providers/src/grok/provider.ts`            | Assigned ids, observable boundary, cause-aware state machine, tree-safe termination, settlement, cleanup. |
| `packages/providers/src/grok/event-parser.ts`        | Boundary observation, terminal-state accessors, interrupted tool closure, abort-result builder.           |
| `packages/providers/src/grok/provider.test.ts`       | Controllable process and full cause/session/race matrix.                                                  |
| `packages/providers/src/grok/event-parser.test.ts`   | Boundary, tool closure, abort shape, and usage tests.                                                     |
| `packages/providers/src/grok/usage-contract.test.ts` | No fabricated accounting on no-`end` interrupt.                                                           |
| `packages/providers/src/types.ts`                    | Correct `interruptSignal`, `stream-abort`, and interrupted-tool comments.                                 |

Do not change `grok/capabilities.ts`, the executor, registry, generated docs, route, or UI in this phase.

## Provider design

### Session identity and argv

Change `buildGrokArgs()` to return the effective expected session identity alongside args/model/effort.

- With no `interruptSignal`, preserve the current args exactly.
- New interrupt-capable turn: generate a UUID and add `--session-id <uuid>`.
- Non-fork resume: add only `--resume <existing>`; expected id is the existing id.
- Fork: add `--resume <source> --fork-session --session-id <new-uuid>`; expected id is the new UUID.
- Preserve the existing error for a non-persistent resume. Do not broaden session persistence semantics.

At settlement, a reported id must equal the expected id. A mismatch returns a terminal `grok_session_id_mismatch` error result, logs expected/reported opaque ids, and never emits `grok_aborted`. An interrupt can be marked successful only with the expected concrete id.

### State and precedence

Use an explicit per-call state rather than inferring cause from exit code:

```text
running pre-M --Stop--> waiting-for-M (bounded by remaining <1s budget)
running post-M --Stop--> interrupting --graceful tree exit--> grok_aborted
waiting-for-M --M--> interrupting --graceful tree exit--> grok_aborted
waiting-for-M --deadline--> terminate tree --> grok_interrupt_unmaterialized
interrupting --grace expires/SIGKILL--> grok_interrupt_forced_kill
any nonterminal state --node Cancel--> existing Query aborted path
natural end before interrupt ownership --> natural result
fault before interrupt ownership --> existing protocol/transport/exit failure
```

Use the exact boundary predicate Phase 1 proved across text-only, reasoning-first, and tool-first turns. If resumed turns passed immediate Stop with their current marker, they may signal immediately; otherwise they use the same `M` gate. Do not key on arbitrary line count, model prose, or one optional content event.

Start one fixed settlement budget when `interruptSignal` aborts. The pre-`M` wait deadline is that 1,000 ms ceiling minus the measured termination-and-drain margin from Phase 1; TERM/KILL escalation consumes only the remaining budget. The setting is not configurable, and success or explicit failure must settle by the original request deadline. Boundary-wait expiry is an explicit failure, not an abort result.

Node Cancel is checked before binary resolution, immediately before spawn, after listener registration, and again at settlement. It wins Stop races and retains `throw new Error('Query aborted')`. A Stop already aborted before spawn still launches only when Phase 1 proved that the selected new/resume/fork policy can materialize and settle within the same bound.

Freeze natural completion as soon as the parser accepts a valid matching `end`; a later Stop during stderr/process cleanup cannot relabel it or send a stale signal. Conversely, exit 130/143, broken pipe, or trailing partial JSON caused after interrupt ownership cannot relabel a proven graceful interrupt as a transport failure. A protocol/transport fault recorded before Stop remains a fault.

### Process ownership

Extend `GrokSpawnOptions` so the caller requests owned-tree mode only when an `interruptSignal` is present. Encapsulate the Phase 1 platform-specific signaling behind `GrokProcess`; the provider state machine requests TERM/KILL for the owned tree without building shell command strings.

- POSIX: use the detached process-group shape proven in Phase 1 and signal only that owned group.
- Windows: use exactly the native tree-control path proven in Phase 1 for the real `.exe` or `.cmd` wrapper.
- Calls without `interruptSignal` retain the pre-feature spawn mode. This keeps the path dormant when capability publication is rolled back.
- Treat already-exited/not-found as benign. Other signal failures are faults with structured logs.
- One termination coordinator owns escalation. An interrupt-involved shutdown uses the Phase 1 budget so success or explicit failure settles within 1,000 ms; a Cancel-only shutdown retains the existing 5,000 ms cleanup grace. A later Cancel records precedence but cannot schedule duplicate signals or extend an earlier Stop deadline.

No broad `pkill`, executable-name matching, unresolved PID glob, or unrelated-child cleanup is allowed.

### Parser and terminal chunks

Add the smallest parser surface needed by the provider:

- `hasReachedInterruptBoundary()` based on the exact Phase 1 event predicate;
- `hasEnded()`;
- `getSessionId()` (already present);
- `closeOutstandingTools(outcome = 'unknown')`; and
- `buildInterruptedResult(sessionId, resumed)`.

`closeOutstandingTools('interrupted')` emits one missing-output `tool_result` per still-open tool and is idempotent. It runs before the abort result. Natural, Cancel, and fault cleanup retain the default `unknown` closure.

`buildInterruptedResult()` requires a non-empty id and emits the exact Grok triple. It includes tokens/cost/usage only when the parser saw authoritative terminal usage. It omits `errors` and never embeds `grok_incomplete_output`.

Settlement order after stdout/stderr/exit have drained:

1. close outstanding tools once with the cause-appropriate outcome;
2. node Cancel -> throw `Query aborted`;
3. prior fault, identity mismatch, unmaterialized deadline, or forced kill -> genuine terminal error/throw under the existing late-I/O accounting rule;
4. graceful operator interrupt -> exact abort result with expected id;
5. existing transport/protocol/nonzero-exit handling; and
6. normal `buildResult()`.

Remove both signal listeners and clear deadline/grace timers in `finally` on natural, interrupted, cancelled, failed, and early-consumer-return paths. Cleanup must await the process/stderr promises without masking the primary outcome.

## TDD matrix

### Characterization before refactor

Add and pass these against current behavior first:

- args snapshots for new, resumed, and forked turns without `interruptSignal`;
- existing Cancel sends TERM and throws `Query aborted`;
- natural result/usage and late-I/O behavior remain unchanged;
- `closeOutstandingTools()` defaults to `unknown` and is idempotent; and
- missing `end` still produces `grok_incomplete_output`.

### Parser tests

| ID  | Scenario                                           | Assertion                                                                                   |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P1  | Events before/at the Phase 1 boundary              | Boundary accessor flips only on the proven event type.                                      |
| P2  | Open tool + `closeOutstandingTools('interrupted')` | One `tool_result`, `toolOutcome:'interrupted'`, `outputState:'missing'`; second call empty. |
| P3  | Default tool closure                               | Existing `unknown` output/wording remains compatible.                                       |
| P4  | Interrupted result without `end`                   | Exact triple + required id; no errors or usage fields.                                      |
| P5  | Interrupted result after matching `end` with usage | Exact triple plus the same authoritative usage fields as `buildResult()`.                   |
| P6  | Normal result without `end`                        | Still `grok_incomplete_output`.                                                             |

### Provider tests

Use a controllable fake process with pushable stdout, independently settled stdout/stderr/exit, recorded tree signals, and fake timers. Do not use multi-second real timers.

| ID  | Scenario                                                              | Assertion                                                                                                   |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| T1  | New/resumed/forked with `interruptSignal`                             | Assigned/expected ids and args follow D2; fork target is distinct from source.                              |
| T2  | No `interruptSignal`                                                  | New/resume/fork args and spawn mode are byte-for-byte unchanged.                                            |
| T3  | Cancel before resolution, before spawn, after spawn                   | No unnecessary spawn in the first two; one tree TERM after spawn; all throw `Query aborted`.                |
| T4  | Stop already aborted or fires across listener registration            | Handler executes exactly once under the Phase 1 new/resume/fork policy.                                     |
| T5  | Stop before `M`, then `M` arrives within budget                       | No signal before `M`; one tree TERM after; graceful exit -> exact abort result.                             |
| T6  | Stop before `M`, deadline expires                                     | Bounded tree termination; `grok_interrupt_unmaterialized`; never abort result.                              |
| T7  | Stop after `M`, no `end`                                              | Expected id supplies resumability; no fabricated usage.                                                     |
| T8  | Stop after `M`, matching `end` with usage wins during drain           | Interrupt classification retained; authoritative usage preserved once.                                      |
| T9  | Resumed and forked interrupted turns                                  | Result uses the proven existing/assigned target id and correct `resumed` value.                             |
| T10 | Reported id differs from expected                                     | `grok_session_id_mismatch`; no system success/abort marker.                                                 |
| T11 | Natural `end` wins Stop race                                          | No tree signal; normal result.                                                                              |
| T12 | Stop-owned exit 130/143, broken pipe, stderr noise, trailing fragment | Proven graceful interrupt remains abort; pre-Stop protocol fault remains failure.                           |
| T13 | Stop then Cancel, Cancel then Stop, repeated Stop                     | One termination schedule; Cancel dominates; no duplicate result/tool closure.                               |
| T14 | Grace expiry                                                          | Tree KILL and `grok_interrupt_forced_kill`; never abort result.                                             |
| T15 | Mid-tool interrupt                                                    | Interrupted tool chunk precedes result; one closure only.                                                   |
| T16 | Listener/timer/process cleanup across all outcomes                    | No listener, timer, or late signal remains.                                                                 |
| T17 | POSIX/Windows process wrapper                                         | Exact Phase 1 spawn/tree primitive selected only in owned-tree mode; benign already-exited handling.        |
| T18 | Complete fake-clock Stop paths                                        | Graceful abort, unmaterialized failure, and forced-kill failure each settle below 1,000 ms by construction. |

Add a usage-contract case proving a no-`end` interrupted result has no `usageBreakdown`, cost, or tokens.

## Implementation order

1. Add characterization tests and confirm they pass before changing behavior.
2. Implement P1–P6 in the parser.
3. Implement identity/argv and process-wrapper seams; pass T1–T4 and T17.
4. Implement the bounded state machine and settlement; pass T5–T16 and T18.
5. Update only the relevant type comments.
6. Run focused and package regression gates with `GROK_CAPABILITIES.interrupt` still false.

## Validation

```bash
cd packages/providers
bun test src/grok/event-parser.test.ts
bun test src/grok/provider.test.ts
bun test src/grok/usage-contract.test.ts
bun test src/registry.test.ts
bun run type-check

cd ../..
bun run lint --max-warnings 0
bun run format:check
```

## Exit criteria

- P1–P6 and T1–T18 pass without weakening existing Grok assertions.
- The capability remains false.
- No successful interrupt result exists without the expected concrete session id.
- No Stop path exceeds the fixed 1,000 ms provider-settlement ceiling in deterministic tests.
- Cancel, natural results, errors, calls without a turn signal, and accounting retain their prior contracts.
