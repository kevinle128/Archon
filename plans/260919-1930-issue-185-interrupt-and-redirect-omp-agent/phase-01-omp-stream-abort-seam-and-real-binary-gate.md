---
phase: 1
title: 'OMP stream-abort seam and real-binary gate'
status: pending
priority: P1
effort: '1d'
dependencies: []
---

# Phase 1: OMP stream-abort seam and real-binary gate

## Goal

Make the OMP provider end one turn on the operator's `interruptSignal` by terminating its child process while keeping the OMP session resumable, and prove on the installed binary that a SIGTERM'd (and a SIGKILL-escalated) turn can be resumed. Calls that never abort the signal stay byte-for-byte on today's path.

Phase 2 must not start until the real-binary gate below records a usable session id across an interrupted turn.

## Context links

- Story 2.5: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:553-583`
- OMP row and traps: `_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md`
- Fixture rule: `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` §"Providers — interrupt conformance"
- Teardown from source: `plans/reports/scoutcli-260912-midturn-cli-providers.md` §1.6–1.7
- Claude precedent: `packages/providers/src/claude/interrupt-resume-spike.ts`, `reports/claude-interrupt-resume-spike.md`, `plans/260919-0139-issue-183-interrupt-and-redirect-claude-agent/phase-01-claude-native-interrupt-seam.md`

## Key insights

- The provider already owns a SIGTERM→SIGKILL `terminate()` path bound to `abortSignal` (Cancel). Interrupt reuses it; the *difference* is entirely in what happens after reap: Cancel throws, interrupt yields a result.
- The parser stores the `session` header privately and never emits it (`event-parser.ts:160-166`). The interrupted result is the only vehicle that can carry the session id to the executor.
- The parser coalesces assistant `text_delta`s into `pendingAssistant` and releases them only on a later event (`consumeMessageUpdate` returns `[]` for `text_delta`; `flushAssistant` is private and fires on `text_end`/`done`/`notice`/tool events). A Stop mid-message therefore leaves partial text buffered; the provider must drain it before the interrupted result or the transcript loses written work.
- `buildResult()` decorates any open tool call / open assistant message as `omp_incomplete_output` (`event-parser.ts:80-104`) and treats `stopReason === 'aborted'` as an error. An interrupted turn is *expectedly* incomplete, so it needs its own builder.
- The scout report's teardown claim was read from v18.1.16 source. The installed binary is v18.1.21. Measure; do not assume.

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/providers/src/community/omp/capabilities.ts` | modify | 1 line | `registry.test.ts` totality/native tests; capability matrix |
| `packages/providers/src/community/omp/provider.ts` | modify | ~40 lines | new interrupt tests; all existing Cancel tests must stay green |
| `packages/providers/src/community/omp/event-parser.ts` | modify | ~20 lines (`buildInterruptedResult`) | new parser tests |
| `packages/providers/src/community/omp/provider.test.ts` | modify | ~120 lines | tests-first below |
| `packages/providers/src/community/omp/event-parser.test.ts` | modify | ~40 lines | tests-first below |
| `packages/providers/src/types.ts` | modify | docstrings only | none |
| `packages/providers/src/community/omp/interrupt-resume-spike.ts` | create | ~250 lines | diagnostic, not CI |
| `packages/providers/package.json` | modify | 1 script line | none |
| `reports/omp-interrupt-resume-spike.md` | create | evidence | gate artifact |

## Dependency map

- Feeds Phase 2: the `terminalReason: 'stream_aborted'` string and the "result-then-return" shape are the contract the executor fixture asserts.
- Feeds Phase 3: the measured SIGTERM/SIGKILL resumability numbers are what the docs state.
- Depends on nothing in this plan; depends on #214's `interruptSignal` option and `interrupt` capability axis (already merged).

## Real-binary gate (`spike:interrupt:omp`)

Create `packages/providers/src/community/omp/interrupt-resume-spike.ts`, following the header conventions of `claude/interrupt-resume-spike.ts` (diagnostic-only, not exported from the barrel, sanitized JSON evidence on stdout, non-zero exit when the protocol cannot be proven). Add `"spike:interrupt:omp": "bun src/community/omp/interrupt-resume-spike.ts"` to `packages/providers/package.json`.

Run it in a disposable temp git repository with the operator's existing OMP login. It must:

1. Spawn `omp --mode json --cwd <tmp> --yolo --no-title --no-extensions -- <prompt that forces a slow tool call, e.g. a bounded `sleep` via bash>`; record the wall time until the `session` header arrives and until the first `message_update`.
2. On the first `tool_execution_start` (run A) and separately on the first assistant `message_update` (run B), send SIGTERM; record exit code, time-to-exit, and every stdout event type emitted between signal and close (any `message_end`? with `stopReason`? with usage fields? `agent_end`? `session_shutdown`?). Whether a final `message_end` carries usage decides how much primary-stream spend an interrupted turn can report.
3. Run C: send SIGTERM then SIGKILL after 200 ms (simulating the escalation) and record the same.
4. For A, B, and C: `omp --mode json --resume <session id> -- <second prompt>` and assert the `session` header id equals the interrupted id, the turn completes with `agent_end`, and the reply references the first prompt's context (sanitized to a boolean, never the text).
5. After each kill, check the process table for survivors: the slow-tool prompt should `touch` a marker file and `sleep`; after the child exits, `pgrep -f <marker-or-sleep-argument>` must be empty. Record the result — a surviving grandchild is a follow-up issue (process-group termination is pre-existing Cancel behaviour, not this story), not a gate failure (red team S1/S4).
6. Record `omp --version` in the evidence document. Reap every child (SIGKILL fallback) and delete the temp repo in `finally`.

The gate is manual and depends on a logged-in `omp` on the executing machine. Policy (red team A2): if no logged-in `omp` is available to the executor, Phase 1 ends `BLOCKED` with that reason — it is never skipped or marked done on the scout report's source reading. The evidence stays valid for the recorded `omp --version`; re-run the spike whenever the installed version changes before relying on it again.

Gate outcomes:

- **Proceed:** the `session` header arrives before any assistant/tool event; `--resume` succeeds after SIGTERM in both A and B; SIGKILL-escalated resume either succeeds or is proven recoverable within a bounded grace that D1 adopts for interrupt.
- **Adjust:** SIGKILL loses the session → raise `TERMINATION_GRACE_MS` (the single grace shared by Cancel, Stop, and I/O-failure termination) to the measured teardown time plus margin, re-run, and record both numbers. A dual grace is rejected: `terminate()` is one first-caller-wins closure with six call sites, so an interrupt-only grace would be silently overridden whenever an I/O rejection caused by the same SIGTERM reached `terminate()` first (red team A4/F3).
- **Block:** the session id never arrives before the first assistant event, or `--resume` fails after a clean SIGTERM. Record evidence and stop; do not substitute Cancel or invent a session id under issue #185.

Write `reports/omp-interrupt-resume-spike.md` with: binary version, command shape (no prompt text), per-run event order, exit codes, timings, resume verdicts. Never record prompts, credentials, or model content.

## Implementation contract

### Capability

`OMP_CAPABILITIES.interrupt: 'stream-abort'` with a comment: "SIGTERM the child on `interruptSignal`; the session is persisted by OMP's signal teardown and resumed with `--resume` (see `reports/omp-interrupt-resume-spike.md`)."

### Provider (`sendQuery`)

- Guard before spawn, right after the existing `abortSignal` guard (`provider.ts:317`): `if (requestOptions?.interruptSignal?.aborted) throw new Error('Query interrupted');`
- Bind `const interruptSignal = requestOptions?.interruptSignal;` beside `abortSignal` (`:381`). Register `onInterrupt = () => terminate()` exactly like `onAbort` (`:424-427`): pre-aborted → call now; else `addEventListener('abort', onInterrupt, { once: true })`.
- After the reap (`:446`), order the checks: existing `if (abortSignal?.aborted) throw new Error('Query aborted');` first; then
  ```ts
  if (interruptSignal?.aborted) {
    for (const chunk of parser.drainPendingAssistant()) yield chunk;
    yield await maybeEnrichResult(parser.buildInterruptedResult(resumeSessionId), { env, cwd, noSession, snapshot });
    getLog().info({ sessionId: parser.getSessionId(), exitCode: exitOutcome.ok ? exitOutcome.value : undefined }, 'omp.query_interrupted');
    return;
  }
  ```
  before `lateIoError`, `protocolError`, and the non-zero-exit branch. A truncated final stdout line after SIGTERM sets `protocolError` inside the read loop, which is why the interrupt check must precede the `protocolError` branch — a parse failure caused by our own signal is not a protocol error.
- `maybeEnrichResult` **does** run on the interrupted result (D2): the child has exited, the pre-spawn snapshot is valid, and the byte-delta path is already fail-soft on a mid-record tail. `sessionId` logging follows the existing `omp.query_completed` precedent (`provider.ts:515`).
- `finally` (`:517`): remove `onInterrupt` alongside `onAbort`.
- No change to argv, env, spawn options, or the happy-path result when the signal never fires.

### Parser

Add `buildInterruptedResult(requestedSessionId: string | undefined): ResultChunk` that returns `{ ...this.buildObservedResult(resumed), terminalReason: 'stream_aborted' }` where `resumed` is `undefined` when no resume was requested and otherwise `this.sessionId === requestedSessionId` (red team A3: an OMP that silently opened a fresh session must surface as `resumed: false`, which the executor already warns on). No `isError`, no `errorSubtype`, no `errors`. Also add `drainPendingAssistant(): MessageChunk[]` — a public wrapper that returns `this.flushAssistant()` — so the provider can release buffered partial text before the result; `buildInterruptedResult` itself yields nothing. Export the marker string from `packages/providers/src/types.ts` as `export const STREAM_ABORTED_TERMINAL_REASON = 'stream_aborted' as const;` — `types.ts` is the zero-dependency contract subpath `@archon/workflows` already imports from (`dag-executor.ts:40`), so Phase 2 adds the same constant to the executor's marker set instead of retyping the string. The parser imports it from `../../types`.

### Types (`types.ts`)

- `interruptSignal` docstring (`:602-609`): providers declaring `'native'` **or `'stream-abort'`** honour it; describe the stream-abort mechanism in one sentence.
- `interrupt` axis (`:839-847`): replace "reserved; no provider declares it yet" with "OMP: SIGTERM the child, session persisted by OMP teardown".
- `terminalReason` docstring (`:351-356`): add `stream_aborted` as the provider-neutral marker a stream-abort provider synthesizes on its own interrupt.

## Tests before (regression coverage written first)

In `omp/provider.test.ts`, add before touching the provider:

1. A never-aborted `interruptSignal` leaves argv, spawn env, and the success result identical to a call without the option (snapshot both `calls[0].command` and the collected chunks).
2. Existing Cancel tests at `:526-561` still pass unchanged (run them first to capture the baseline).

In `omp/event-parser.test.ts`:

3. `buildResult()` behaviour is unchanged for open tool / open message / `stopReason: 'aborted'` (pin the current `omp_incomplete_output` and error decoration so the new builder cannot leak into it).

## Refactor (protected code changes)

- Extract nothing new beyond `buildInterruptedResult`; keep `terminate()`/`scheduleKill` as the single termination path so Cancel and Stop cannot drift.
- If the spike forces a longer grace, raise the single `TERMINATION_GRACE_MS` constant; do not parameterize `scheduleKill` per cause (see the Adjust branch above).
- Test fixture (red team A1): give `makeRunningProcess(exitOn, stdoutFailure?, exitCode = 0)` an exit-code parameter so interrupt tests resolve 143 on SIGTERM / 137 on SIGKILL. Today it always resolves `0`, which means an ordering regression that let the non-zero-exit branch run first would still pass every test. Existing Cancel tests keep the default `0`.

## Tests after (new behaviour)

`omp/provider.test.ts` (use `makeRunningProcess`, `makeSpawner`, `collect`, `waitFor`):

4. Interrupt mid-stream: after the child printed `session`, a `message_start`, two `text_delta` updates (no `text_end`), and a `tool_execution_start`, abort `interruptSignal` → child receives `['SIGTERM']` and the fake resolves exit code **143**; the collected chunks contain one `assistant` chunk with the concatenated partial text immediately before exactly one `result` `{ sessionId, terminalReason: 'stream_aborted' }`, no `isError`, no throw, no `omp_exit_nonzero` (this is what makes the post-reap ordering falsifiable and proves buffered text is not lost).
5. Interrupt escalates SIGTERM→SIGKILL when the child ignores SIGTERM (mirror `:537-548`, fake resolves **137**); still result-shaped. This test waits the real 5 s grace like its Cancel twin — give it the same explicit `7_000` ms timeout and keep it the only additional real-timer wait in the file (red team F5; AGENTS.md bimodal-timeout note).
6. Interrupt when SIGTERM makes stdout reject (mirror `:550-561`) → still result-shaped, `omp_transport_error` not emitted.
6b. Interrupt when SIGTERM truncates the last stdout line (fake pushes `{"type":"mess` then closes) → still result-shaped; `omp_protocol_error` not emitted.
7. Interrupt before the `session` header arrived → result has no `sessionId` (the executor's explicit failure owns this; the provider does not invent one).
7b. Interrupt on a resumed turn whose observed `session` id differs from `resumeSessionId` → `resumed: false`; equal ids → `resumed: true`; no resume requested → `resumed` absent.
8. Cancel and Stop co-fire → `Query aborted` is thrown (Cancel dominates); exactly one SIGTERM.
9. Pre-aborted `interruptSignal` → throws `Query interrupted`, `calls.length === 0`.
10. Listener cleanup: after a normal completion and after an interrupted end, aborting the signal later invokes `kill` zero more times (spy on the fake `kill`).
11. Usage observed before the interrupt survives on the interrupted result (`tokens`, `usageBreakdown`, `resolvedModel` when the fake emitted a `message_end`).
12. The interrupted result is the last chunk collected, and hidden-session enrichment ran on it: using the `session-usage` test fixtures' layout (`omp/__fixtures__`), append one advisor usage record to the hidden session file after the pre-spawn snapshot, interrupt, and assert the interrupted result's `usageBreakdown` includes that entry; with no hidden files the result deep-equals `buildInterruptedResult(...)` on a parser fed the same lines.

`omp/event-parser.test.ts`:

13. `drainPendingAssistant()` on a parser holding two un-flushed `text_delta`s returns one `assistant` chunk and a second call returns `[]`; `buildInterruptedResult(undefined)` on a parser with open tool + partial usage → `sessionId`, usage fields, `terminalReason: 'stream_aborted'`, no error fields, `resumed` absent; `buildInterruptedResult('<observed id>')` → `resumed: true`; `buildInterruptedResult('<other id>')` → `resumed: false`.

`registry.test.ts`:

14. Add "OMP advertises stream-abort interrupt" asserting the `=== 'stream-abort'` set equals `['omp']`; keep "only Claude advertises native interrupt" untouched.

## Todo

- [ ] Write tests 1–3 (before), run, all green on the unchanged provider.
- [ ] Write tests 4–14, run, confirm they fail for the right reason.
- [ ] Implement capability flip, provider listener/ordering, parser builder, types docstrings.
- [ ] Run tests 1–14 green; run the full `omp/*.test.ts` set and `registry.test.ts`.
- [ ] Write and run the spike; write `reports/omp-interrupt-resume-spike.md`; decide Proceed / Adjust / Block.
- [ ] If Adjust: raise `TERMINATION_GRACE_MS`, re-run the spike, update test 5's timeout and the report.
- [ ] Record the post-kill process-table result; open a follow-up issue if a grandchild survived.

## Regression gate

```bash
cd packages/providers
bun test src/community/omp/provider.test.ts
bun test src/community/omp/event-parser.test.ts
bun test src/registry.test.ts
bun run type-check
cd ../..
bun run generate:capability-matrix && bun run check:capability-matrix
```

Then, manually, with the operator's OMP login: `bun --filter @archon/providers spike:interrupt:omp` and review the sanitized report.

## Success criteria

- All Cancel-path tests unchanged and green; interrupt tests green; type-check clean with no casts.
- The spike report exists, is sanitized, records `omp --version` and the process-table check, and states a Proceed (or Adjust with the adopted grace) verdict — or the phase is `BLOCKED` with the reason.
- The capability matrix renders `**stream-abort**` for OMP and `check:capability-matrix` passes.

## Risk assessment

- **SIGKILL escalation loses the session.** Mitigated by the spike's run C and the Adjust branch (one raised shared grace).
- **Session header arrives late.** Measured by the spike; the executor's explicit failure is the fail-fast owner; documented in Phase 3.
- **OMP emits a late `message_end`/`agent_end` during teardown that flips parser state.** `buildInterruptedResult` ignores completeness, so late events can only add usage — the desired effect.
- **Provider now receives `interruptSignal` on every OMP pass.** Test 1 pins the unchanged happy path.

## Security considerations

- The spike never logs prompt text, credentials, or model output; the evidence document is booleans, event types, timings, and exit codes.
- No new privileges: SIGTERM/SIGKILL target only the child the provider spawned.

## Next steps

Phase 2 consumes `stream_aborted` and the result-then-return shape; it must re-scout `dag-executor.ts` anchors before editing.
