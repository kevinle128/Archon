# Codex interrupt + resume spike report

Real-SDK gate for the planned `interrupt: 'stream-abort'` capability seam on `@openai/codex-sdk`. Sanitized — no prompts, tokens, thread ids, home paths, or command content.

## Command

```bash
cd packages/providers && bun run spike:interrupt:codex
# => bun src/codex/interrupt-resume-spike.ts
```

Linux evidence was collected by running the same spike entrypoint inside
`archon-dev-runtime:latest` (Linux aarch64 / linuxkit) with a writable Codex home,
`CODEX_BIN_PATH` pointing at the locked `0.144.5` linux-arm64 vendor binary, and
`procps` available for descendant PID capture.

## SDK pin

- Declared range (`packages/providers/package.json`): `^0.144.5`
- Locked / required runtime: `0.144.5` (matches `bun.lock`)

## Multi-OS matrix

Provider capabilities are not platform-scoped. Archon ships Linux, macOS, and Windows binaries; every required OS family must PASS. Untested families are **BLOCKED**, not skipped. WSL evidence would file under Linux, never Windows.

| OS family | Status      | Notes                                                                                                              |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| macos     | **PASS**    | native host (`darwin/arm64`, Bun 1.3.14)                                                                           |
| linux     | **PASS**    | Docker Desktop linuxkit aarch64 (`archon-dev-runtime`, Bun 1.3.11); same locked SDK + linux-arm64 binary `0.144.5` |
| windows   | **BLOCKED** | no usable native Windows host in this environment                                                                  |

## Outcome

**BLOCKED** — untested OS family: **windows**. macOS and Linux host gates both **PASS** with the same measured terminal class.

Phase 2 (US-002) may enable `interrupt: 'stream-abort'` only when this report is PASS on native Linux, macOS, and Windows. A BLOCKED report leaves production capability `false`.

---

## macos (darwin/arm64)

- **Date**: 2026-09-19T20:15:10.231Z
- **OS release**: 25.6.0
- **Bun**: 1.3.14
- **Declared SDK range**: `^0.144.5`
- **Locked version (bun.lock / expected)**: `0.144.5`
- **Resolved runtime version**: `0.144.5`
- **Credentials present**: yes
- **Binary resolvable**: yes
- **Overall**: **PASS**

### Case A — mid-tool interrupt

- Thread id retained before abort: true
- Aborted while command active: true
- Settlement ms: 16504 (bound 60000)
- Settlement within bound: true
- Event order (types only): `thread.started` → `turn.started` → `item.completed:error` → `item.completed:agent_message` → `item.started:command_execution`
- thread.started index: 0; command started index: 4
- Buffered command completed after abort: false
- Terminal kind: `throw`; constructor: `Error`; name: `AbortError`
- Terminal fragments: `The operation was aborted.`
- Sanitized message: `The operation was aborted.`
- Descendants captured: 9; surviving after cleanup: 0; cleanup elapsed ms: 4514

### Case B — early operator intent (deferred abort)

- Intent marked before thread.started: true
- Abort deferred until id retained: true
- Thread id retained: true
- Same terminal class as A: true
- Settlement ms: 104
- Event order (types only): `thread.started`
- Terminal fragments: `The operation was aborted.`
- Sanitized message: `The operation was aborted.`

### Case C — resume continuity (3 cycles)

- Cycle 1: resumeThread=true; startThreadFallback=false; naturalCompletion=true; priorContext=true; settlementMs=7075; withinBound=true
- Cycle 2: resumeThread=true; startThreadFallback=false; naturalCompletion=true; priorContext=true; settlementMs=7163; withinBound=true
- Cycle 3: resumeThread=true; startThreadFallback=false; naturalCompletion=true; priorContext=true; settlementMs=13176; withinBound=true

### Case D — runtime safety

- unhandledRejection count: 0
- uncaughtException count: 0

### Gate checklist

| Field                          | Result |
| ------------------------------ | ------ |
| `runtime_version`              | PASS   |
| `credentials`                  | PASS   |
| `binary`                       | PASS   |
| `caseA_ran`                    | PASS   |
| `caseA_thread_id_before_abort` | PASS   |
| `caseA_mid_tool_abort`         | PASS   |
| `caseA_terminal_deterministic` | PASS   |
| `caseA_settlement`             | PASS   |
| `caseA_descendants_gone`       | PASS   |
| `caseB_ran`                    | PASS   |
| `caseB_deferred_abort_with_id` | PASS   |
| `caseB_same_terminal_class`    | PASS   |
| `caseB_settlement`             | PASS   |
| `resume_three_cycles`          | PASS   |
| `resume_cycle_1_resumeThread`  | PASS   |
| `resume_cycle_1_context`       | PASS   |
| `resume_cycle_1_settlement`    | PASS   |
| `resume_cycle_2_resumeThread`  | PASS   |
| `resume_cycle_2_context`       | PASS   |
| `resume_cycle_2_settlement`    | PASS   |
| `resume_cycle_3_resumeThread`  | PASS   |
| `resume_cycle_3_context`       | PASS   |
| `resume_cycle_3_settlement`    | PASS   |
| `no_unhandled_rejection`       | PASS   |
| `no_uncaught_exception`        | PASS   |

---

## linux (linux/arm64, linuxkit)

- **Date**: 2026-09-19T20:20:16.074Z
- **OS release**: 6.12.72-linuxkit
- **Bun**: 1.3.11
- **Declared SDK range**: `^0.144.5`
- **Locked version (bun.lock / expected)**: `0.144.5`
- **Resolved runtime version**: `0.144.5`
- **Credentials present**: yes
- **Binary resolvable**: yes (`@openai/codex-linux-arm64@0.144.5` vendor binary via `CODEX_BIN_PATH`)
- **Overall**: **PASS**

### Case A — mid-tool interrupt

- Thread id retained before abort: true
- Aborted while command active: true
- Settlement ms: 3317 (bound 60000)
- Settlement within bound: true
- Event order (types only): `thread.started` → (multiple `item.completed:error`) → `item.started:command_execution` (command-started index 35)
- thread.started index: 0; command started index: 35
- Buffered command completed after abort: true
- Terminal kind: `throw`; constructor: `Error`; name: `AbortError`
- Terminal fragments: `The operation was aborted.`
- Sanitized message: `The operation was aborted.`
- Descendants captured: 7; surviving after cleanup: 0; cleanup elapsed ms: 2018

### Case B — early operator intent (deferred abort)

- Intent marked before thread.started: true
- Abort deferred until id retained: true
- Thread id retained: true
- Same terminal class as A: true
- Settlement ms: 159
- Event order (types only): `thread.started`
- Terminal fragments: `The operation was aborted.`
- Sanitized message: `The operation was aborted.`

### Case C — resume continuity (3 cycles)

- Cycle 1: resumeThread=true; startThreadFallback=false; naturalCompletion=true; priorContext=true; settlementMs=4072; withinBound=true
- Cycle 2: resumeThread=true; startThreadFallback=false; naturalCompletion=true; priorContext=true; settlementMs=3317; withinBound=true
- Cycle 3: resumeThread=true; startThreadFallback=false; naturalCompletion=true; priorContext=true; settlementMs=3579; withinBound=true

### Case D — runtime safety

- unhandledRejection count: 0
- uncaughtException count: 0

### Gate checklist

| Field                          | Result |
| ------------------------------ | ------ |
| `runtime_version`              | PASS   |
| `credentials`                  | PASS   |
| `binary`                       | PASS   |
| `caseA_ran`                    | PASS   |
| `caseA_thread_id_before_abort` | PASS   |
| `caseA_mid_tool_abort`         | PASS   |
| `caseA_terminal_deterministic` | PASS   |
| `caseA_settlement`             | PASS   |
| `caseA_descendants_gone`       | PASS   |
| `caseB_ran`                    | PASS   |
| `caseB_deferred_abort_with_id` | PASS   |
| `caseB_same_terminal_class`    | PASS   |
| `caseB_settlement`             | PASS   |
| `resume_three_cycles`          | PASS   |
| `resume_cycle_1_resumeThread`  | PASS   |
| `resume_cycle_1_context`       | PASS   |
| `resume_cycle_1_settlement`    | PASS   |
| `resume_cycle_2_resumeThread`  | PASS   |
| `resume_cycle_2_context`       | PASS   |
| `resume_cycle_2_settlement`    | PASS   |
| `resume_cycle_3_resumeThread`  | PASS   |
| `resume_cycle_3_context`       | PASS   |
| `resume_cycle_3_settlement`    | PASS   |
| `no_unhandled_rejection`       | PASS   |
| `no_uncaught_exception`        | PASS   |

---

## windows

_No evidence collected. Recorded as **BLOCKED** per Phase 1 gate (untested OS family). No Parallels/Windows VM or native windows-latest host was available in this environment. Do not treat WSL or linuxkit as Windows evidence._

---

## Phase 2 terminal predicate (from measured host variants)

Narrow discriminants observed on **both** macOS and Linux (identical class — do **not** broaden to generic `killed` / `signal` / `SUBPROCESS_CRASH_PATTERNS`):

- error `name`: `AbortError`
- error `constructor`: `Error`
- stable message fragment (exact): `The operation was aborted.`
- kind: `throw` (async iterator rejects; not a clean close and not a `turn.failed` event)

Notes for Phase 2:

- Node Cancel must still win first and surface `Query aborted` (existing provider path).
- Operator-forwarded abort evidence requires **all** of: node Cancel not set, `operatorAbortForwarded` for this attempt, and terminal matching the fragments above.
- A natural `turn.completed` racing Stop stays natural.
- SDK source at 0.144.5 can also throw `Codex Exec exited with signal ${signal}: …` after kill; that variant was **not** observed on macOS or linuxkit when aborting via `TurnOptions.signal` — the iterator settled with `AbortError` / `The operation was aborted.` instead. Phase 2 must not invent the unobserved variant as required evidence; if a later OS (Windows) surfaces a different narrow shape, enumerate it separately.

## Production impact

None. This spike does not modify `CODEX_CAPABILITIES`, `CodexProvider`, or `dag-executor.ts`.

## Blocker for Phase 2

`windows` family untested → overall **BLOCKED**. Re-run `bun run spike:interrupt:codex` on a native Windows host (or maintained Windows CI/VM with the same locked SDK), merge its section into this report, and only then allow US-002 to flip `interrupt: 'stream-abort'`.
