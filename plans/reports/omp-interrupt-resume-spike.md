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
- Each conformance case starts a new session and embeds the boolean-context token in the interrupted turn. This verifies that a first-turn Stop can actually resume the session it reports, rather than proving only a previously persisted session.
- Sanitized output only: event **types**, timings, hashed session/pid correlation. No prompts, generated text, credentials, raw session ids, or non-temp paths.

## Gate decision (US-003)

| Check                             | Result           |
| --------------------------------- | ---------------- |
| darwin assistant-text conformance | **fail**         |
| darwin active-tool conformance    | **pass**         |
| linux evidence                    | **missing**      |
| win32 evidence                    | **missing**      |
| owner-scoped platform decision    | **not recorded** |
| `capabilityFlipAllowed`           | **false**        |
| `OMP_CAPABILITIES.interrupt`      | stays `false`    |

**BLOCKED**: the darwin assistant case cannot resume a brand-new interrupted session, and linux/win32 have no evidence. The issue needs a separately reviewed OMP/session-persistence remedy before any platform can advertise this capability; platform scope alone cannot cure the first-turn failure. Do not silently ship static `'stream-abort'` after macOS-only evidence.

## Raw characterization (darwin / 18.1.21)

### Case 1 — assistant text interrupt

| Fact                    | Observed                                            |
| ----------------------- | --------------------------------------------------- |
| Trigger                 | first `assistantMessageEvent.type === 'text_delta'` |
| Session first?          | **yes**                                             |
| Session-header latency  | **507 ms**                                          |
| SIGTERM → child exit    | **39 ms**                                           |
| SIGKILL fired?          | **no**                                              |
| Exit code               | `143`                                               |
| Owned descendants alive | **none**                                            |
| Session id hash         | `d5f3a01f27fa5f5e`                                  |

### Case 2 — active tool interrupt

| Fact                    | Observed                                       |
| ----------------------- | ---------------------------------------------- |
| Trigger                 | `tool_execution_start` while shell tool active |
| Session first?          | **yes**                                        |
| Session-header latency  | **509 ms**                                     |
| SIGTERM → child exit    | **15 ms**                                      |
| SIGKILL fired?          | **no**                                         |
| Exit code               | `143`                                          |
| Tool descendant         | PID file marker; owned PID dead after return   |
| Owned descendants alive | **none**                                       |
| Session id hash         | `98ba1cfa51064ec6`                             |

## Provider conformance (darwin / 18.1.21)

Both cases run end-to-end through `OmpProvider` with a spike-only teeing spawner.

### Case 1 — assistant-text

| Fact                              | Observed                 |
| --------------------------------- | ------------------------ |
| Session first?                    | **yes**                  |
| Graceful SIGTERM (no SIGKILL)     | **yes**                  |
| signal → full provider return     | **24 ms** (&lt; 1000 ms) |
| `terminalReason`                  | `stream_aborted`         |
| result `isError`                  | absent / false           |
| Owned descendants alive           | **none**                 |
| Resume same id                    | **no**                   |
| Resume reached natural completion | **no**                   |
| Resume context boolean challenge  | **no**                   |
| Session id hash                   | `9523860b35fb20df`       |
| Pass                              | **false**                |

### Case 2 — active-tool

| Fact                              | Observed                        |
| --------------------------------- | ------------------------------- |
| Session first?                    | **yes**                         |
| Graceful SIGTERM (no SIGKILL)     | **yes**                         |
| signal → full provider return     | **17 ms** (&lt; 1000 ms)        |
| `terminalReason`                  | `stream_aborted`                |
| Owned descendants alive           | **none** (OMP child + tool PID) |
| Resume same id                    | **yes**                         |
| Resume reached natural completion | **yes**                         |
| Resume context boolean challenge  | **yes**                         |
| Session id hash                   | `9a981e7025379d7a`              |
| Pass                              | **true**                        |

## Blocking OMP limitation

A **brand-new** assistant session interrupted mid-first-assistant-message receives a live `session` header id, but OMP does not make that session resumable before SIGTERM exit. The fresh assistant resume challenge failed to report the same id or reach `agent_end`; therefore an initial OMP turn cannot safely enter redirect-idle. The active-tool case did resume in this run, but both cases are required. The provider must not advertise Stop until the OMP persistence behavior is repaired and every advertised platform passes the same gate.

## Pass / fail snapshot

| Criterion                      | assistant-text | active-tool  |
| ------------------------------ | -------------- | ------------ |
| Session header before work     | pass           | pass         |
| SIGTERM without SIGKILL        | pass           | pass         |
| Provider return &lt; 1000 ms   | pass (24 ms)   | pass (17 ms) |
| `stream_aborted` marked result | pass           | pass         |
| No owned descendant alive      | pass           | pass         |
| Same-id resume + context       | **fail**       | pass         |
| linux / win32 evidence         | **missing**    | **missing**  |

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
