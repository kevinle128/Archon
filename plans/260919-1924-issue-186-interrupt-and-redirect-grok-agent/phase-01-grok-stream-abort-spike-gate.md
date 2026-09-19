---
phase: 1
title: 'Grok protocol, process, version, and platform spike gate'
status: pending
priority: P1
effort: '0.5-1d'
dependencies: []
---

# Phase 1: Grok protocol, process, version, and platform spike gate

## Goal

Establish whether Grok can satisfy the story before production code advertises `stream-abort`. Prove session persistence at the earliest possible Stop, graceful termination timing, child cleanup, repeat interruption, and native Windows behaviour against a recorded CLI version.

Phase 2 is blocked until every release gate below passes. “Usually resumable” is not sufficient because the public outcome promises same-session continuation after Stop.

## Inputs

- `packages/providers/src/claude/interrupt-resume-spike.ts` and `packages/providers/src/claude/askhuman-resume-spike.ts` for sanitized spike structure and timeouts;
- `packages/providers/src/grok/provider.ts` for the exact launch flags, binary resolution, Windows wrapper, and five-second cleanup timer;
- Grok's installed `14-headless-mode.md`, `17-sessions.md`, and `18-sandbox.md`;
- official Node/Bun signal and detached-process documentation linked from [plan.md](./plan.md).

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `packages/providers/src/grok/interrupt-resume-spike.ts` | create | Diagnostic-only real-CLI runner; not exported and not run in CI |
| `packages/providers/package.json` | modify | Add `spike:interrupt:grok` beside the Claude spike command |
| `plans/reports/spike-260920-0243-grok-interrupt-resume.md` | create | Sanitized evidence and release-gate decision |

No production provider/capability code changes in this phase.

## Safety and reproducibility

- Resolve the executable with `resolveGrokBinaryPath` and record the exact `grok --version` output. Add `--no-auto-update` to every spike model invocation so the executable cannot change mid-run.
- Run in a new temporary git repository, never the Archon checkout or home directory. Add `--sandbox workspace`; note in the report that this constrains writes but Grok's documented sandbox still permits broad reads.
- Use fresh caller-generated UUIDs and unique non-secret nonce values. Never write prompt text, model content, credentials, environment values, or home paths to the report.
- Put every process behind a bounded experiment timeout. In `finally`, terminate spike-owned processes, delete only the exact sessions created by the spike with `grok sessions delete <id>` from the matching cwd, and remove the temporary directory. If session cleanup fails, list only the UUIDs for manual cleanup; never delete a broad `~/.grok` path.
- For the orphan check, create a temporary slow-tool script that writes its own PID before waiting. Check and clean up that exact PID; do not use a broad `pkill`/`pgrep` pattern.

## Experiments

The script should share one line parser and one result schema. Record event **types**, `end.stopReason`, session-ID equality, whether standalone `usage` and final aggregate usage were seen, exit value, signal-to-exit duration, child liveness, and resume booleans only.

| ID | Experiment | Pass condition |
| --- | --- | --- |
| S0 | Preflight: version, `--session-id` acceptance, normal new-session completion with an assigned UUID | Flag is accepted; exit 0; `end.sessionId` equals the assigned UUID. The report identifies the conservative minimum version for this feature. |
| S1 | POSIX mid-tool Stop: launch a platform-appropriate temporary slow-tool, wait until its PID file proves the child is running, send SIGTERM, then resume the assigned session with a nonce check | Parent exits on SIGTERM in under one second and within the proposed grace, without SIGKILL; any `end` ID matches; the exact child PID is gone; resume exits 0 on the same ID and demonstrates retained context. |
| S2 | POSIX earliest Stop: send SIGTERM immediately after spawn, before the first stdout line, then resume the assigned session | Parent exits in under one second; resume succeeds on the same ID with retained context. If it does not, the story is blocked; do not downgrade this to a documented early-turn limitation. |
| S3 | Repeated Stop: resume the S1 session, interrupt another turn, then resume once more | Both interrupted turns preserve the same session and the final continuation succeeds. |
| S4 | Native Windows: repeat S1 and S2 through the actual resolved `.exe` or `.cmd`/`cmd.exe` path used by `buildSpawnCommand` | Under-one-second graceful exit and same-ID resume both pass. A forceful Windows termination or lost session blocks capability publication. |

Fork syntax does not need another paid experiment: bundled CLI docs plus `buildGrokArgs` unit tests cover `--resume <old> --fork-session --session-id <new>`. Do not spend model calls duplicating the engine's already-covered queue/race cases.

## Release gates

All must be true in the report:

1. caller-assigned session IDs are accepted on the tested version and returned by normal completion;
2. S1, S2, and S3 resume the same session with retained context;
3. ordinary SIGTERM exit completes in under one second, remains inside a documented cleanup grace, and never requires SIGKILL;
4. the spike-owned slow-tool child is gone after the parent exits, or the report specifies that Phase 2 must add POSIX process-group ownership;
5. S4 passes on native Windows under Archon's real launch path;
6. the minimum supported CLI version/floor and upgrade guidance are explicit;
7. standalone/final usage presence is recorded without inventing spend.

If any gate fails, mark the report `BLOCKED`, attach the evidence to issue #186, and stop. A platform exclusion or a delayed-until-safe-boundary design requires an explicit product/architecture decision and a revised plan; it is not implied authority for the implementer.

## Implementation steps

1. Add the diagnostic script and package command using the Claude spike's timeout and sanitized-output patterns.
2. Run S0-S2 on native macOS and Linux, S3 on at least one POSIX platform, and S4 on native Windows. Do not infer native Windows behaviour from WSL.
3. Write the report with: environment, exact version, command, event/timing tables, cleanup result, minimum-version decision, process-tree decision, and `PASS`/`BLOCKED` for each gate.
4. Re-run the report if the Grok binary version changes before Phase 2 or before release.
5. Run the existing provider/parser baseline after the spike files are added.

## Verification

```bash
cd packages/providers
bun run spike:interrupt:grok
bun test src/grok/event-parser.test.ts
bun test src/grok/provider.test.ts
cd ../..
bun run lint --max-warnings 0
```

Run the spike command separately on native Windows for S4; do not include real-CLI execution in CI.

## Completion checklist

- [ ] Spike and package command exist and are diagnostic-only
- [ ] S0-S2 evidence recorded on macOS and Linux; S3 repeated-interrupt evidence recorded on POSIX
- [ ] S4 evidence recorded on native Windows
- [ ] Exact created sessions and child processes cleaned up
- [ ] Minimum CLI version and termination grace chosen from evidence
- [ ] Process-group requirement decided from evidence
- [ ] Every release gate says `PASS`, or the issue is explicitly blocked
- [ ] Existing Grok parser/provider tests remain green

## Rollback

Remove the diagnostic script and package command. The report remains a historical evidence record; no runtime state or product behaviour changed.
