---
phase: 1
title: 'Grok stream-abort spike gate'
status: pending
priority: P1
effort: '0.5d'
dependencies: []
---

# Phase 1: Grok stream-abort spike gate

## Goal

Prove, against the installed Grok CLI, what a `grok --single … --output-format streaming-json` process emits when it is SIGTERMed mid-turn, whether the session it was running survives, and whether `--resume <id>` continues that session — so the provider contract in Phase 2 is built on observed behaviour, not on docs alone.

Phase 2 must not start until the gate below records outcome **A** or **B**.

## Context links

- Plan decisions D3 and D4 in [plan.md](./plan.md).
- Precedent: `packages/providers/src/claude/interrupt-resume-spike.ts`, `packages/providers/package.json` (`spike:interrupt:claude`), `reports/claude-interrupt-resume-spike.md`.
- Grok docs: `~/.grok/docs/user-guide/14-headless-mode.md` ("streaming-json", "Interrupted Headless Runs"), `17-sessions.md` (`-s/--session-id`, `--resume`).
- Grok scout: `plans/reports/scoutcli-260912-midturn-cli-providers.md` §2.6-2.7.
- Current provider: `packages/providers/src/grok/provider.ts` (`defaultSpawner`, `scheduleKill`, `TERMINATION_GRACE_MS`), `packages/providers/src/grok/event-parser.ts` (`consumeEnd`).

## Key insights

- Grok's session id is only visible on `end` (`event-parser.ts:290-292`), and `end` is documented as "always the last event". A stream-abort kills the emitter, so the id source must be settled empirically.
- `--session-id <UUID>` is accepted with `--single` and validated before any model call (verified locally: `grok --single hi --session-id not-a-uuid …` → "Error: --session-id must be a valid UUID"). It creates a new session; with `--resume` it is legal only together with `--fork-session`.
- Docs promise "session state saved up to the last completed tool call" on SIGTERM and exit code 143. Whether a kill that lands before any tool call leaves a resumable session is not documented.
- Bun's `proc.exited` is typed `Promise<number>`; what it resolves to for a signal-terminated child (143 from Grok's own handler vs. a signal exit) must be recorded because the provider must not classify by exit code.

## Files

| File | Action | Change |
| --- | --- | --- |
| `packages/providers/src/grok/interrupt-resume-spike.ts` | create | Diagnostic-only script (not exported from the barrel, not run by tests/CI). Spawns the real binary with the provider's own `resolveGrokBinaryPath`, drives the experiments below, prints one sanitized JSON evidence document, exits non-zero when the protocol cannot be proven. |
| `packages/providers/package.json` | modify | Add `"spike:interrupt:grok": "bun src/grok/interrupt-resume-spike.ts"` beside `spike:interrupt:claude`. |
| `reports/grok-interrupt-resume-spike.md` | create | Sanitized evidence: command, `grok --version`, per-experiment event-type sequences, exit values, timings, session-id equality, outcome A/B/C. Never record prompt text, credentials, env values, or model content. |

No production code changes in this phase.

## Experiments

Run in a disposable temporary git repository (`mkdtemp`) and delete it afterwards. `--cwd` is not a filesystem boundary and Grok's sandbox is off by default (`18-sandbox.md:5`), so pass `--sandbox workspace` (write limited to the cwd, temp dirs, and `~/.grok/`) on every spike invocation in addition to the provider's `--permission-mode bypassPermissions`. The provider itself never passes `--sandbox`; the flag is a spike-only containment layer and does not change the streaming-json protocol under test. Choose prompts that make the model run at least one tool (for example: "list the files here with the shell tool, then explain each in detail") so a mid-tool kill is reachable; keep the prompt text out of the report.

| # | Experiment | Mechanical pass condition |
| --- | --- | --- |
| E1 | New session with `--session-id <uuid1>`; SIGTERM after the first `tool_call` event (kill from the `tool_call` line, no delay). | Record: every event `type` before/after the kill, whether an `end` line arrives and its `stopReason`/`sessionId`, `exited` value, wall time from SIGTERM to exit. `sessionId`, if present, equals `uuid1`. |
| E2 | Resume `uuid1` with `--resume uuid1 --single "<continuation>"` and let it complete. | Exit 0, `end.sessionId === uuid1`, and the reply demonstrably references the first turn (record only a boolean, e.g. the model repeats a nonce number given in E1's prompt). |
| E3 | New session with `--session-id <uuid2>`; SIGTERM on the first `text`/`thought` event, before any `tool_call`. | Record the same fields as E1. Then resume as in E2; record whether resume succeeds and whether prior context survived. This decides the C-partial branch of D4. |
| E4 | Resume `uuid1` again and SIGTERM mid-turn, then resume once more to completion. | Session stays usable across a second interrupt (`end.sessionId === uuid1` on the final turn). |
| E5 | Fork: `--resume uuid1 --fork-session --session-id <uuid3>`; complete normally. | Exit 0 and `end.sessionId === uuid3` — proves pre-assignment also works for forks (D3). |
| E7 | Orphaned tool children: prompt Grok to run a slow shell command (for example `sleep 20`), SIGTERM on its `tool_call` event, then after `grok` exits check with `pgrep -f` (scoped to the temp cwd / the sleep argument) whether the child survived. | Record whether the child was reaped. If it survives, Phase 2 must signal the process group (precedent: `packages/providers/src/claude/container-spawn.ts:99-119` kills the group first, then the pid) instead of the `grok` pid alone; if reaped, record that Grok owns its children and no provider change is needed. |
| E8 | Pre-event kill: new session with `--session-id <uuid4>`, SIGTERM immediately after spawn, before any stdout line. Then attempt `--resume uuid4`. | Record whether the session directory exists, whether resume succeeds, and the exit value. Feeds the C-partial decision: a Stop landing before the first event is the earliest operator action and D3's id must either resume or fail with a named error. |
| E6 | Kill timing: measure whether Grok exits within `TERMINATION_GRACE_MS` (5000 ms) after SIGTERM in E1/E3/E4. | If any exit exceeds 5000 ms, record it — Phase 2 must raise the grace for the interrupt path rather than let SIGKILL truncate session persistence. |

Each experiment is wrapped in the same experiment timeout pattern as the Claude spike (`runWithExperimentTimeout`) and classifies failures as `timeout`, `authentication`, `model-unavailable`, or `runtime-error`.

## Gate outcomes

- **A — `end` flushed on SIGTERM.** E1 shows an `end` with `stopReason: 'cancelled'` (or another value; record it) and a session id, and E2/E4 resume with context. Phase 2 keeps the flushed spend and asserts `end.sessionId === pre-assigned id`.
- **B — no `end` on SIGTERM, resume works.** E1 shows the stream closing without `end`, and E2/E4 still continue `uuid1` with context. Phase 2 relies on the pre-assigned id (D3) and emits the abort-marked result without spend.
- **C — not resumable.** E2 or E4 fails (resume error, or a fresh empty session). Blocker: stop, record, do not build Phase 2 on a fabricated id or a fresh-session fallback. Escalate on the issue with the report attached.
- **C-partial.** Only E3's or E8's resume fails or loses context (kill before the first completed tool call or before the first event). Proceed, but Phase 2 must (a) document that a Stop during the pre-tool phase of a Grok turn leaves an unresumable session and (b) surface Grok's resume error verbatim on the redirect turn (the executor's existing failure path) rather than starting a new session.

## Tests before (TDD)

The spike is diagnostic, not a unit under test. The regression gate for this phase is that no existing test changes:

```bash
cd packages/providers && bun test src/grok/provider.test.ts && bun test src/grok/event-parser.test.ts
```

## Implementation steps

1. Copy the structure of `claude/interrupt-resume-spike.ts` (sanitized JSON output, failure classifier, experiment timeout) into `grok/interrupt-resume-spike.ts`; reuse `runWithExperimentTimeout` from `claude/askhuman-resume-spike.ts` if importing across provider folders is already accepted there, otherwise inline a minimal timeout helper.
2. Resolve the binary through `resolveGrokBinaryPath(undefined, process.env)` so the spike uses exactly the provider's lookup.
3. Implement a small line reader over `Bun.spawn(...).stdout` that records event `type`s (and `stopReason`, `sessionId`, `usage` presence on `end`) and lets an experiment trigger `proc.kill('SIGTERM')` on a chosen event type.
4. Run E1-E8 in order; abort the run with a non-zero exit and a `failureCategory` when authentication fails.
5. Write `reports/grok-interrupt-resume-spike.md` following the Claude report's sections (Command, CLI version, Outcome, Protocol observed, evidence tables per experiment, timings, decision A/B/C).
6. Record the outcome at the top of Phase 2 before starting it.

## Todo

- [ ] Spike script created and runnable via `bun run spike:interrupt:grok` from `packages/providers`
- [ ] E1-E8 executed against `grok 1.0.34`; sanitized report written to `reports/grok-interrupt-resume-spike.md`
- [ ] Gate outcome (A / B / C / C-partial) recorded in the report and in Phase 2's header
- [ ] Existing Grok provider and parser tests still pass

## Success criteria

- The report states one outcome with per-experiment evidence tables and exit/timing values.
- Outcome A or B is recorded, or a C blocker is filed on issue #186 with the report attached.
- No production file changed; `bun run lint` passes on the new script (`--max-warnings 0`).

## Risk assessment

- Grok credit is spent (roughly six short turns). Keep prompts short and tool use minimal.
- Grok's SIGTERM handler may be slower than 5 s in a tool-heavy turn (E6 captures this; Phase 2 adapts the grace only for the interrupt path).
- The installed CLI may auto-update; pin the version string in the report and rerun the spike if the pinned binary changes before Phase 2 ships.

## Security considerations

- Report contains no prompt text, session paths under the home directory beyond the encoded layout name, credentials, or model output.
- The spike runs with `bypassPermissions` (always-approve); `--sandbox workspace` is the only real write boundary, so keep it on every invocation and never run the spike inside the Archon checkout or the operator's home directory.

## Next steps

Phase 2 consumes the outcome to fix D2's spend expectations and D3's id source; Phase 4 links the report from the closeout evidence list.
