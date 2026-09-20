# OMP interrupt/resume spike — US-003 conformance gate

Diagnostic only. Production capability flip is **blocked**.  
`OMP_CAPABILITIES.interrupt` remains `false`.

Source harness: `packages/providers/src/community/omp/interrupt-resume-spike.ts`  
Script: `cd packages/providers && bun run spike:interrupt:omp`  
Evidence document: single sanitized JSON on stdout (`LOG_LEVEL=silent` / `setLogLevel('silent')`).

## Environment

| Field                                    | Value                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `omp --version`                          | `omp/18.1.21`                                                              |
| OS / arch (this run)                     | `darwin` / `arm64`                                                         |
| Binary resolution                        | `resolveOmpBinaryPath()` (installed login reused; no credentials recorded) |
| Resolver-supported platforms             | `darwin`, `linux`, `win32`                                                 |
| Characterized this run                   | `darwin` only                                                              |
| Uncharacterized (release gap)            | `linux`, `win32`                                                           |
| Owner-scoped platform decision on record | **no**                                                                     |
| Capability at spike time                 | `interrupt: false`                                                         |
| Capability flip allowed                  | **no**                                                                     |

## Method

- Unique `mkdtemp` git repo per spike run; disposed in `finally`.
- **Raw leg**: direct OMP spawn, SIGTERM on trigger, owned-PID tracking only.
- **Conformance leg**: `OmpProvider` + spike-only teeing spawner; `interruptSignal` abort on trigger; measure signal→full provider return; then `--resume` same id with boolean context challenge.
- Session seed: one short completed turn first (flushes on-disk session). OMP emits a session id on brand-new mid-text SIGTERM but does **not** write the session file — fresh never-flushed sessions cannot `--resume`. Seeding matches multi-turn production nodes.
- Sanitized output only: event **types**, timings, hashed session/pid correlation. No prompts, generated text, credentials, raw session ids, or non-temp paths.

## Gate decision (US-003)

| Check                             | Result           |
| --------------------------------- | ---------------- |
| darwin assistant-text conformance | **pass**         |
| darwin active-tool conformance    | **pass**         |
| linux evidence                    | **missing**      |
| win32 evidence                    | **missing**      |
| owner-scoped platform decision    | **not recorded** |
| `capabilityFlipAllowed`           | **false**        |
| `OMP_CAPABILITIES.interrupt`      | stays `false`    |

**BLOCKED** pending either (a) linux + win32 real-binary conformance on the same omp version, or (b) an explicit owner decision to advertise stream-abort on a reduced platform set and expand provider/registry/matrix/docs accordingly. Do not silently ship static `'stream-abort'` after macOS-only evidence.

## Raw characterization (darwin / 18.1.21)

### Case 1 — assistant text interrupt

| Fact                    | Observed                                            |
| ----------------------- | --------------------------------------------------- |
| Trigger                 | first `assistantMessageEvent.type === 'text_delta'` |
| Session first?          | **yes**                                             |
| Session-header latency  | **480 ms**                                          |
| SIGTERM → child exit    | **136 ms**                                          |
| SIGKILL fired?          | **no**                                              |
| Exit code               | `143`                                               |
| Owned descendants alive | **none**                                            |
| Session id hash         | `9197a061fd49365a`                                  |

### Case 2 — active tool interrupt

| Fact                    | Observed                                       |
| ----------------------- | ---------------------------------------------- |
| Trigger                 | `tool_execution_start` while shell tool active |
| Session first?          | **yes**                                        |
| Session-header latency  | **506 ms**                                     |
| SIGTERM → child exit    | **114 ms**                                     |
| SIGKILL fired?          | **no**                                         |
| Exit code               | `143`                                          |
| Tool descendant         | PID file marker; owned PID dead after return   |
| Owned descendants alive | **none**                                       |
| Session id hash         | `9eeaca6954ec159e`                             |

## Provider conformance (darwin / 18.1.21)

Both cases run end-to-end through `OmpProvider` with a spike-only teeing spawner.

### Case 1 — assistant-text

| Fact                              | Observed                 |
| --------------------------------- | ------------------------ |
| Session first?                    | **yes**                  |
| Graceful SIGTERM (no SIGKILL)     | **yes**                  |
| signal → full provider return     | **38 ms** (&lt; 1000 ms) |
| `terminalReason`                  | `stream_aborted`         |
| result `isError`                  | absent / false           |
| Owned descendants alive           | **none**                 |
| Resume same id                    | **yes**                  |
| Resume reached natural completion | **yes**                  |
| Resume context boolean challenge  | **yes**                  |
| Session id hash                   | `7c0a8377a8750f51`       |
| Pass                              | **true**                 |

### Case 2 — active-tool

| Fact                              | Observed                        |
| --------------------------------- | ------------------------------- |
| Session first?                    | **yes**                         |
| Graceful SIGTERM (no SIGKILL)     | **yes**                         |
| signal → full provider return     | **14 ms** (&lt; 1000 ms)        |
| `terminalReason`                  | `stream_aborted`                |
| Owned descendants alive           | **none** (OMP child + tool PID) |
| Resume same id                    | **yes**                         |
| Resume reached natural completion | **yes**                         |
| Resume context boolean challenge  | **yes**                         |
| Session id hash                   | `2a3e7dba57f71241`              |
| Pass                              | **true**                        |

## Known OMP limitation (not a provider bug)

A **brand-new** session interrupted mid-first-assistant-message receives a live `session` header id, but OMP does not flush a session file before SIGTERM exit. `--resume <id>` then fails with “Session not found.” Conformance seeds one short completed turn first so interrupt/resume exercises a real on-disk session (the multi-turn path production nodes use). Fresh never-flushed single-turn Stop remains an OMP persistence gap to track separately — it must not be papered over by inventing session ids.

## Pass / fail snapshot

| Criterion                      | assistant-text        | active-tool           |
| ------------------------------ | --------------------- | --------------------- |
| Session header before work     | pass                  | pass                  |
| SIGTERM without SIGKILL        | pass                  | pass                  |
| Provider return &lt; 1000 ms   | pass (38 ms)          | pass (14 ms)          |
| `stream_aborted` marked result | pass                  | pass                  |
| No owned descendant alive      | pass                  | pass                  |
| Same-id resume + context       | pass (seeded session) | pass (seeded session) |
| linux / win32 evidence         | **missing**           | **missing**           |

## Reproduction

```bash
cd packages/providers
LOG_LEVEL=silent bun run spike:interrupt:omp
# stdout: single sanitized JSON document; exit 0 when this-platform conformance passes
```

## Non-goals confirmed

- No capability flip (`interrupt` remains `false`).
- No executor / server / UI production edits.
- Spike not exported from `@archon/providers` barrel.
- No prompts, model text, credentials, or raw session ids in this report or spike stdout.
