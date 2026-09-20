---
phase: 1
title: 'Measure the locked Codex abort/resume protocol'
status: pending
priority: P1
effort: '1d'
dependencies: []
---

# Phase 1: measure the locked Codex abort/resume protocol

## Goal

Measure the behavior Archon must normalize at the exact installed SDK resolution on native Linux, macOS, and Windows before changing production behavior. Provider capabilities are not platform-scoped and Archon releases all three OS families, so a subprocess-lifecycle result from only one host is insufficient. This phase is an executable protocol gate, not a prototype of the feature: it must not flip `CODEX_CAPABILITIES`, change `CodexProvider`, or change executor classification.

## Files

| File                                                                                                     | Change                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/providers/src/codex/interrupt-resume-spike.ts`                                                 | Add a bounded, credentialed real-SDK probe using the same SDK entry point as the provider.                         |
| `packages/providers/package.json`                                                                        | Add `spike:interrupt:codex`.                                                                                       |
| `plans/260920-0216-issue-184-interrupt-and-redirect-codex-agent/reports/codex-interrupt-resume-spike.md` | Commit a sanitized environment/protocol/result report; no prompt, token, thread id, home path, or command content. |

## Preflight and safety

1. Resolve the installed `@openai/codex-sdk` entry and its nearest package metadata; require runtime version `0.144.5`, matching `bun.lock`. Report the declared caret separately so the report does not falsely call `package.json` an exact pin.
2. Run the protocol on native Linux, macOS, and Windows with the same usable Codex authentication and binary resolution as production. WSL counts as Linux, not Windows. Missing credentials, missing binary, a different SDK version, or an untested OS family is `BLOCKED`, not a skip or pass. This may use maintained local/CI hosts; it does not require a permanent new workflow.
3. Create a disposable git repository with `mkdtemp`, a unique nonce in its committed context, and no access to the project checkout. Remove it in `finally` after process checks complete.
4. Constrain the probe thread to that repository with `sandboxMode: 'workspace-write'`, `networkAccessEnabled: false`, `approvalPolicy: 'never'`, no additional directories, and normal git-repository checking. Production currently uses broader Codex options, but abort/event semantics do not require giving a diagnostic probe access to the project or external tools.
5. Bound each iterator settlement and each resumed turn with explicit timeouts. Record elapsed milliseconds; never leave a promise or child process running after a failed assertion. After recording any survivor, terminate only the exact captured descendant PIDs with `SIGTERM`, wait a bounded interval, and use `SIGKILL` only for those that remain.
6. Install temporary `unhandledRejection` and `uncaughtException` recorders before the first SDK call. Any event is a hard failure. Restore the listeners in `finally`; do not teach the spike or server to ignore a new error class.

## Protocol cases

Run the following against a harmless, deterministic long-running command in the disposable repo. Sanitize command text from logs and the report.

### A. New-thread mid-tool interrupt

- Call `startThread().runStreamed()` with a dedicated controller.
- Record only event types and relative order: `thread.started`, the target `item.started`, any buffered `item.completed`, and the terminal event/throw/clean close.
- Retain the non-empty thread id from `thread.started`, capture all descendant PIDs of the spike process immediately before abort, then abort the SDK signal while the command is still active.
- Record the exact terminal discriminant, error constructor/name, and stable message fragments required to distinguish this SDK abort from an unrelated crash. Do not record a broad `killed`/`signal` classifier as sufficient.
- Require the async iterator to settle within the bound.

### B. Early operator intent

- Start a fresh streamed turn and mark operator intent before `thread.started`.
- Deliberately defer the actual SDK controller abort until the `thread.started` event has been consumed and its id retained. This tests the implementation strategy required by the same-thread contract; do not raw-abort the new thread before an id exists and then accept loss of resumability.
- Require the same measured terminal class as case A and a non-empty retained id.

### C. Resume continuity and repetition

- Resume each interrupted id with `resumeThread(id)`, ask for the committed nonce and an unambiguous follow-up value, and require a natural completion that demonstrates prior context was retained.
- Perform three bounded interrupt/resume cycles in total, reusing the same protocol, and report each result. Three successes are a regression signal, not a statistical reliability claim.
- Assert every resume uses the interrupted id. The spike must never call `startThread()` as fallback.

### D. Process and runtime cleanup

- Before abort, use the platform process table (`ps` with PID, PPID, and a process-start fingerprint on POSIX; the equivalent PowerShell/CIM process inventory on native Windows) to traverse and store every descendant of the spike, including shells and grandchildren. Checking process names alone is insufficient because descendants may be reparented or omit `codex` from their command; verify the start fingerprint again before signalling a captured PID so PID reuse cannot target an unrelated process.
- After iterator settlement and a short bounded cleanup interval, require every captured descendant PID to be gone. Report counts and elapsed time, not commands or identifiers. The failure-cleanup path must terminate only validated captured descendants, never a broad name/pattern.
- Require zero unhandled rejections and zero uncaught exceptions after a final event-loop turn.

## Report schema and gate

The report must include:

- one section per required OS family with date, OS/architecture, Bun version, declared SDK range, locked version, and resolved runtime version;
- event-order summaries for cases A and B;
- the exact sanitized terminal variant for each OS, used by Phase 2's predicate; if variants differ, identify only the narrow stable discriminants for each rather than merging them into a broad string matcher;
- iterator-settlement times, `thread.started`-before-abort result, and descendant cleanup result;
- all three same-id resume/context results;
- unhandled rejection/exception counts;
- final `PASS` or `BLOCKED`, with a reason for every failed field.

Phase 2 may begin only if every item below is true on native Linux, macOS, and Windows:

- runtime version is exactly `0.144.5`;
- a fresh thread exposes a non-empty id before the deferred abort is sent;
- the terminal shape is deterministic enough to recognize without broad crash-string matching;
- every iterator settles within its bound;
- all three resumes complete on the same id with context retained;
- all captured descendants exit;
- no unhandled rejection or uncaught exception occurs.

If any condition fails, leave Codex interrupt capability `false`, commit the blocked report if it is useful and sanitized, and revise the architecture with new evidence before proceeding.

## Steps

1. Write the spike and its report serializer; add the package script.
2. Run it once as a smoke check, then run the complete three-cycle protocol.
3. Inspect the report for secrets, prompt/command text, ids, and absolute user paths before committing it.
4. Compare its terminal evidence with the planned predicate in Phase 2 and narrow Phase 2 to the observed variant; do not expand the accepted error surface.

## Verification

```bash
cd packages/providers
bun run spike:interrupt:codex
bun x tsc --noEmit
```

The spike owns and cleans up its temporary repository and child processes. It starts no server, watcher, or persistent daemon.
