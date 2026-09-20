# OMP interrupt/resume spike — interim raw characterization (US-001)

Diagnostic only. No production provider/parser/executor changes.  
`OMP_CAPABILITIES.interrupt` remains `false`.

Source harness: `packages/providers/src/community/omp/interrupt-resume-spike.ts`  
Script: `cd packages/providers && bun run spike:interrupt:omp`

## Environment

| Field                         | Value                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `omp --version`               | `omp/18.1.21`                                                                                                     |
| OS / arch                     | `darwin` / `arm64`                                                                                                |
| Binary resolution             | `resolveOmpBinaryPath()` (installed login reused; no credentials recorded)                                        |
| Resolver-supported platforms  | `darwin`, `linux`, `win32`                                                                                        |
| Characterized this run        | `darwin` only                                                                                                     |
| Uncharacterized (release gap) | `linux`, `win32` — capability must not flip on macOS-only evidence without an owner-scoped decision (US-003 gate) |
| Capability at spike time      | `interrupt: false`                                                                                                |

## Method

- Unique `mkdtemp` git repo per spike run; disposed in `finally`.
- Production-shaped argv: `--mode json --cwd <tmp> --yolo --no-title --no-extensions -- <prompt>`.
- Owned PIDs only (OMP child + tool PID file); reap in `finally`; never broad `pkill`.
- Output is sanitized JSON on stdout: event **types**, timings, hashed session/pid correlation. No prompts, generated text, credentials, raw session ids, or paths outside the disposable repo.
- Two independent raw cases, then an inert provider-conformance scaffold (awaits US-002 `interruptSignal` seam).

## Case 1 — assistant text interrupt

| Fact                                     | Observed                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger event                            | first `assistantMessageEvent.type === 'text_delta'` (`assistant_text_delta`)                                                                                                            |
| Session first?                           | **yes** (`sessionWasFirst: true`)                                                                                                                                                       |
| Session-header latency                   | **481 ms** from spawn                                                                                                                                                                   |
| Pre-signal event-type order (abbrev.)    | `session` → `advisor_cost_changed` → `agent_start` → `turn_start` → `message_start` → `message_end` → `message_start` → many `message_update` (thinking deltas before first text delta) |
| Post-SIGTERM event types                 | additional `message_update` only (stream drained briefly after signal)                                                                                                                  |
| `tool_execution_end` after signal        | no                                                                                                                                                                                      |
| `message_end` after signal               | no                                                                                                                                                                                      |
| `agent_end` after signal                 | no                                                                                                                                                                                      |
| usage-bearing `message_end` after signal | no                                                                                                                                                                                      |
| SIGTERM → child exit                     | **136 ms**                                                                                                                                                                              |
| SIGKILL fired?                           | **no**                                                                                                                                                                                  |
| Exit code                                | `143` (`128 + SIGTERM`)                                                                                                                                                                 |
| Owned descendants alive after return     | **none**                                                                                                                                                                                |
| Session id correlation (hash)            | `f81768cb80250803`                                                                                                                                                                      |

### Design implications (for US-002)

- Session header reliably precedes turn work on this host/version.
- Graceful SIGTERM alone is sufficient mid-text; no force-kill.
- OMP does **not** emit a natural `agent_end` / usage `message_end` after SIGTERM — the provider must drain buffered assistant text and synthesize the interrupted `result` itself.
- Post-signal `message_update` traffic is possible; interrupt mode must keep accepting/draining until process exit without treating truncated JSON as a hard protocol failure when interrupt owns termination.

## Case 2 — active tool interrupt

| Fact                                             | Observed                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Trigger event                                    | `tool_execution_start` while the shell tool is active                                                                    |
| Session first?                                   | **yes**                                                                                                                  |
| Session-header latency                           | **504 ms** from spawn                                                                                                    |
| Pre-signal event-type order (abbrev.)            | `session` → `advisor_cost_changed` → `agent_start` → `turn_start` → assistant message cycle → **`tool_execution_start`** |
| Post-SIGTERM event types                         | `tool_execution_update` only                                                                                             |
| `tool_execution_end` after signal                | **no**                                                                                                                   |
| `message_end` / `agent_end` / usage after signal | no                                                                                                                       |
| SIGTERM → child exit                             | **114 ms**                                                                                                               |
| SIGKILL fired?                                   | **no**                                                                                                                   |
| Exit code                                        | `143`                                                                                                                    |
| Tool descendant                                  | PID file written with unique marker; tracked owned PID dead after return                                                 |
| Owned descendants alive after return             | **none**                                                                                                                 |
| Session id correlation (hash)                    | `103212ab059b68a2`                                                                                                       |

### Design implications (for US-002)

- Active-tool Stop can land after `tool_execution_start` with no subsequent `tool_execution_end` — open tools must remain open for executor settlement (`toolOutcome: 'interrupted'` only when an errored end arrives for a tool that was active at interrupt start).
- No surviving owned descendant observed on darwin/18.1.21 for this bounded shell tool. Plan remains unblocked on orphan grounds **for this platform/version only**.

## Provider conformance scaffold

| Case           | Status                                                                |
| -------------- | --------------------------------------------------------------------- |
| assistant-text | skipped — `OmpProvider interruptSignal` seam not implemented (US-002) |
| active-tool    | skipped — same                                                        |

Scaffold lives in the same spike file and instantiates `OmpProvider` with a spike-only spawner shape so US-003 can measure signal→full-provider-return without further harness invention.

## Pass / fail snapshot (raw leg only)

| Criterion                         | assistant-text                      | active-tool                   |
| --------------------------------- | ----------------------------------- | ----------------------------- |
| Session header before work        | pass                                | pass                          |
| Trigger observed                  | pass (`assistant_text_delta`)       | pass (`tool_execution_start`) |
| SIGTERM without SIGKILL           | pass (136 ms / 114 ms)              | pass                          |
| No owned descendant alive         | pass                                | pass                          |
| Full provider return &lt; 1000 ms | n/a (raw leg; conformance deferred) | n/a                           |
| Same-id resume + context          | n/a (US-003)                        | n/a                           |
| linux / win32 evidence            | **missing**                         | **missing**                   |

Raw characterization on **darwin + omp/18.1.21** is sufficient for US-001 (harness + observed trigger facts).  
US-003 remains the release blocker for flipping `interrupt` to `'stream-abort'`.

## Reproduction

```bash
cd packages/providers
bun run spike:interrupt:omp
# stdout: single sanitized JSON document
```

## Non-goals confirmed

- No edits to `provider.ts` / `event-parser.ts` / `capabilities.ts` / executor.
- Spike not exported from `@archon/providers` barrel.
- No prompts, model text, credentials, or raw session ids in this report or spike stdout.
