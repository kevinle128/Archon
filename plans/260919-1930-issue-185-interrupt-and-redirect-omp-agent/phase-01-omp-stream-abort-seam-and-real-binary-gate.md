---
phase: 1
title: 'OMP graceful stream-abort seam and real-binary gate'
status: pending
priority: P1
effort: '1.5d'
dependencies: []
---

# Phase 1: OMP graceful stream-abort seam and real-binary gate

## Goal

Prove the installed OMP CLI can gracefully stop assistant and active-tool turns, persist and resume the exact session, and leave no child work running. Then implement the smallest first-cause-aware provider/parser seam that emits a deterministic interrupted result without weakening Cancel or hiding real failures.

Phase 2 is blocked until the real-binary gate passes for the version/platform pairs on which the release will advertise this capability.

## Files

| File | Change |
| --- | --- |
| `packages/providers/src/community/omp/capabilities.ts` | advertise `'stream-abort'` after the gate passes |
| `packages/providers/src/community/omp/provider.ts` | pending-header interrupt, termination ownership/escalation, result normalization, truthful resume outcome |
| `packages/providers/src/community/omp/event-parser.ts` | natural-end query, interrupt mode, pending-text drain, interrupted result |
| `packages/providers/src/community/omp/provider.test.ts` | termination races, resume semantics, enrichment, cleanup |
| `packages/providers/src/community/omp/event-parser.test.ts` | parser interrupt behavior and result field boundary |
| `packages/providers/src/registry.test.ts` | capability pin |
| `packages/providers/src/types.ts` | shared marker and accurate public docs |
| `packages/providers/src/community/omp/interrupt-resume-spike.ts` | versioned diagnostic; not exported |
| `packages/providers/package.json` | `spike:interrupt:omp` script |
| `plans/reports/omp-interrupt-resume-spike.md` | sanitized gate evidence |

## Prerequisite baseline

Run `bun install --frozen-lockfile` from the repository root to restore the expected Bun workspace dependencies, then run the existing OMP parser/provider/registry tests before editing. The plan review's test attempt failed at module resolution for `@archon/paths`; do not confuse that environment failure with a passing or failing behavior baseline.

## Mandatory real-binary gate

Build a diagnostic following the process hygiene and output conventions of the Claude spike, using `resolveOmpBinaryPath`, a unique `mkdtemp` git repository, the operator's existing OMP login, and no production exports. It must not mutate a real repository or retry model calls automatically.

The spike has two layers. Its raw characterization leg observes the JSONL event that triggers the signal and can run before provider edits. Its post-implementation conformance leg instantiates `OmpProvider` with a spike-only spawner that tees stdout: one branch goes unchanged to the provider and one records event types/timing. This makes “signal to full provider return” measurable without changing production parsing or logging.

Run two independent cases:

1. assistant case: interrupt after the first assistant text delta;
2. tool case: start a bounded shell tool with a unique marker, interrupt after `tool_execution_start` while the process is active.

For each case and platform, capture only sanitized facts:

- exact `omp --version`, OS/architecture, event-type order, and whether `session` was first;
- session-header latency, SIGTERM-to-child-exit time, and signal-to-full-provider-return time;
- whether SIGKILL fallback fired;
- event types after SIGTERM, including tool end, `message_end`, `agent_end`, and usage presence;
- whether `--resume <id>` reported the exact same id, reached `agent_end`, and proved prior context via a boolean challenge;
- whether the OMP child and the uniquely marked tool descendant are both gone after the provider returns.

The tool command writes its own PID to a file in the disposable repository before its bounded wait. The diagnostic must track those exact owned PIDs, apply cleanup in `finally`, and never record prompts, generated text, credentials, raw session ids, or use a broad process match.

Pass only if both cases:

- observe the session header before assistant/tool work;
- terminate through SIGTERM without SIGKILL on POSIX, or through an equivalently graceful and empirically proven mechanism on another enabled platform;
- return through the full provider path in less than 1,000 ms from the signal;
- resume the same id with context intact;
- leave no OMP or tool descendant alive.

Run this gate on macOS, Linux, and Windows because the current resolver supports all three and the capability constant has no platform dimension. If a release intentionally supports fewer platforms, that scope must be an explicit owner decision recorded in the plan/docs—not inferred from whichever machine ran the spike.

If login is unavailable, a required platform is unavailable, the version differs from the evidence being relied on, a case exceeds the UX budget, forceful termination occurs, resume changes/loses the id, or a descendant survives, record the reason and mark this phase `BLOCKED`. Do not flip the capability, tune the shared grace speculatively, label a force-killed turn interrupted, or defer a survivor to a follow-up. If a platform cannot pass, obtain the owner decision described in the index plan before designing a dynamic platform capability. A surviving descendant requires a separately reviewed, cross-platform owned-process-tree design before this plan can proceed.

## Implementation contract

### Termination state

- Keep one termination path, but replace the unlabelled `terminate()` calls with a first-writer-wins cause: `cancel`, `interrupt`, `interrupt-unresumable`, `transport`, `protocol`, or `cleanup`. Track whether the scheduled SIGKILL callback actually runs.
- Node Cancel preserves its current pre-spawn guard and wins final classification whenever `abortSignal.aborted`, even if Stop fired first.
- The interrupt listener records a pending request. If the parser already has a session and has not observed `agent_end`, it claims interrupt ownership and sends SIGTERM. Otherwise, wait at most `INTERRUPT_SESSION_HEADER_WAIT_MS = 500`; after each parsed line, start the pending interrupt immediately when the session header becomes available and before yielding later work.
- If turn activity is observed before the header or the 500 ms deadline expires, terminate with `interrupt-unresumable` and emit an unmarked `omp_interrupt_session_unavailable` error after reap. The operator flag alone must not route that failure to idle.
- If `agent_end` or process exit wins before interrupt ownership, keep the natural result. If transport/protocol termination owns first, keep the real error even if Stop fires while reap is pending.
- Remove both abort listeners and clear the timer on every exit. Cleanup termination is never classified as operator interrupt.
- If SIGKILL fires, drain any safe buffered assistant text, then emit one unmarked `isError` result with `errorSubtype: 'omp_interrupt_force_killed'` and observed accounting/session metadata. The executor must fail, not idle.

### Parser behavior

Add narrow methods rather than exposing parser internals:

- `hasSession(): boolean` / existing session getter for the pending interrupt;
- `hasTurnActivity(): boolean`, so pre-header protocol drift fails closed instead of extending the wait;
- `hasNaturalTurnEnded(): boolean`, true only for the current turn's observed `agent_end`;
- `beginOperatorInterrupt(): void`, called only after interrupt ownership is acquired;
- `drainPendingAssistant(): MessageChunk[]`, an idempotent wrapper over the existing flush;
- `buildInterruptedResult(resumed: boolean | undefined)`, containing only session, accounting/model fields, `resumed` when applicable, and `terminalReason: STREAM_ABORTED_TERMINAL_REASON`.

The interrupted builder omits `stopReason`, `structuredOutput`, `isError`, `errorSubtype`, and `errors`, even if a prior subevent populated them. It does not fabricate a session id.

While interrupt mode is active, an errored end for a tool that was active when interruption began emits one `tool_result` with `toolOutcome: 'interrupted'` and no failure system message. A late successful tool end stays `success`; tools with no end remain open for executor settlement. Normal parsing is byte-for-byte unchanged when interrupt mode never begins.

### Result and resume behavior

- Drain pending assistant text before the terminal result, enrich that result with existing hidden-session usage fail-soft, log only existing safe identifiers, yield it once, and return.
- Compute `resumed` only for the new interrupted result: ordinary resume requires observed-id equality; fork requires an observed session header; absent request omits the field; missing/mismatched evidence is false. Preserve all existing non-interrupted success/error behavior and tests.
- Export `STREAM_ABORTED_TERMINAL_REASON = 'stream_aborted' as const` from `packages/providers/src/types.ts`. Broaden the `terminalReason`, `interruptSignal`, and provider capability comments to cover deterministic adapter-synthesized stream-abort markers.
- Do not change OMP argv, environment, spawn permissions, happy-path chunk order, hidden-session storage, or the five-second emergency fallback.

## Test plan

Write the behavior tests before production edits. Extend `makeRunningProcess` with explicit exit code and controllable close/error timing. Do not add a second real five-second wait: use reliable fake timers if they work in this file, otherwise consolidate Cancel and Stop escalation assertions into the one existing real-timer test.

Provider/parser cases:

1. A never-aborted interrupt signal produces the same command and chunks as no signal; late abort after completion sends no signal.
2. Immediate fresh-turn Stop still spawns, waits for the session header, then sends one SIGTERM and returns the real id. No work chunk is required before termination. A turn event before the header and a 500 ms header timeout each return `omp_interrupt_session_unavailable` without a marker.
3. Mid-text Stop drains coalesced deltas once, then emits exactly one last marked result without completion/error fields.
4. Active-tool Stop maps a Stop-caused errored tool end to `interrupted`; a late success remains `success`; an open tool remains open for the executor.
5. Cancel alone and Cancel+Stop retain `Query aborted`; co-fire sends at most one SIGTERM.
6. Interrupt-owned stdout rejection or truncated JSON after SIGTERM remains a graceful marked result; a transport or protocol error that owns termination before Stop retains its original error/throw.
7. `agent_end` then Stop before process close remains a normal unmarked result.
8. Forced escalation emits `omp_interrupt_force_killed`, no interrupt marker, and no success classification.
9. Fresh process exit before a session header is an incomplete/error result, never a fabricated interrupted session; the pending header timer is cleared on every exit.
10. Interrupted ordinary-resume equality/mismatch and fork-with/without-header set `resumed` conservatively; existing normal resume/fork tests stay unchanged.
11. Observed primary usage and hidden-session delta enrichment survive the interrupt. Build the minimal temporary hidden-session layout in the provider test; do not reference a nonexistent shared `omp/__fixtures__` directory.
12. Listener/timer cleanup holds after normal, graceful-interrupt, first-cause failure, and force-kill paths.
13. Existing incomplete-output, model error, structured-output, Cancel, transport, and hidden-usage suites remain unchanged and green.
14. Registry tests assert exactly `['claude']` is native and exactly `['omp']` is stream-abort.

## Commands

```bash
cd packages/providers
bun test src/community/omp/event-parser.test.ts
bun test src/community/omp/provider.test.ts
bun test src/community/omp/session-usage.test.ts
bun test src/registry.test.ts
bun run type-check
bun run spike:interrupt:omp
```

Review `plans/reports/omp-interrupt-resume-spike.md` before Phase 2. Matrix generation belongs to Phase 3.

## Completion gate

- All focused tests and provider type-check pass.
- The spike meets every pass condition for every advertised version/platform pair and its report contains no sensitive content.
- Capability is flipped only after that evidence exists.
- Any block leaves OMP interrupt capability `false` and is reported rather than worked around.
